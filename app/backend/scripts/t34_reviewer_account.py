"""T34 评审账号(有效期 7 天):创建、隔离验证、样本数据与到期回收脚本。

与 T31 的差异:
  - 有效期由 24 小时改为 7 天(168 小时)
  - 使用全新邮箱 t34.reviewer@atoms-demo.dev,不复用已删除账号数据
  - 回收脚本改为幂等、可重复执行,并写明到期日期

依赖环境变量(平台注入,不落盘、不打印):
  SUPABASE_URL          Supabase 项目 URL
  SUPABASE_ACCESS_TOKEN Management API 访问令牌(仅用于建号与核对)
  SUPABASE_ANON_KEY     匿名 key(REST/Auth 调用)

产出:
  app/backend/reports/t34-reviewer-account.json   账号信息 + 隔离验证证据(不含密码)
  app/backend/reports/t34-reviewer-revoke.sql     到期回收脚本(幂等)
  /tmp/t34-reviewer-credentials.txt               凭据交付文件(不纳入版本控制)
"""
import json
import os
import secrets
import string
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

PROJECT_REF = "pofchtyjqwevchiiqags"
REVIEWER_EMAIL = "t34.reviewer@atoms-demo.dev"
REVIEWER_NAME = "T34 验收评审"
VALID_HOURS = 24 * 7
REPORT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "reports")

MGMT_BASE = "https://api.supabase.com/v1"
URL = os.environ["SUPABASE_URL"].rstrip("/")
TOKEN = os.environ["SUPABASE_ACCESS_TOKEN"]
ANON = os.environ["SUPABASE_ANON_KEY"]

steps = []
evidence = {}


def log(name, ok, detail=""):
    steps.append({"name": name, "ok": bool(ok), "detail": detail})
    print(f"{'PASS' if ok else 'FAIL'} {name}" + (f" | {detail}" if detail else ""))


def mgmt_sql(query):
    req = urllib.request.Request(
        f"{MGMT_BASE}/projects/{PROJECT_REF}/database/query",
        data=json.dumps({"query": query}).encode(),
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode() or "[]")


def rest(path, token=None, init=None):
    init = init or {}
    headers = {"apikey": ANON, "Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    headers.update(init.get("headers", {}))
    req = urllib.request.Request(f"{URL}/rest/v1/{path}", data=init.get("body"), headers=headers,
                                 method=init.get("method", "GET"))
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            text = resp.read().decode()
            return resp.status, (json.loads(text) if text else None)
    except urllib.error.HTTPError as exc:
        text = exc.read().decode()
        try:
            body = json.loads(text)
        except json.JSONDecodeError:
            body = text
        return exc.code, body


def login(email, password):
    req = urllib.request.Request(
        f"{URL}/auth/v1/token?grant_type=password",
        data=json.dumps({"email": email, "password": password}).encode(),
        headers={"apikey": ANON, "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read().decode())
    return data["access_token"], data["user"]["id"]


def rand_password():
    alphabet = string.ascii_letters + string.digits
    return "Rv" + "".join(secrets.choice(alphabet) for _ in range(18)) + "!7"


def main():
    password = rand_password()
    created_at = datetime.now(timezone.utc)
    expires_dt = created_at + timedelta(hours=VALID_HOURS)
    expires_at = expires_dt.isoformat()

    # 1) 建号:邮箱已确认 + 邮箱身份,注册触发器自动创建资料与默认工作区
    existing = mgmt_sql(f"select id from auth.users where email = '{REVIEWER_EMAIL}';")
    if existing:
        mgmt_sql(f"delete from auth.users where email = '{REVIEWER_EMAIL}';")
        print(f"已清理同邮箱旧账号 {REVIEWER_EMAIL}")
    mgmt_sql(
        f"""
        with new_user as (
          insert into auth.users (
            instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
            raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
            confirmation_token, recovery_token, email_change_token_new, email_change
          ) values (
            '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
            '{REVIEWER_EMAIL}', crypt('{password}', gen_salt('bf')), now(),
            '{{"provider":"email","providers":["email"]}}',
            '{{"full_name":"{REVIEWER_NAME}"}}',
            now(), now(), '', '', '', ''
          ) returning id, email
        ), new_identity as (
          insert into auth.identities (id, user_id, identity_data, provider, provider_id,
                                       last_sign_in_at, created_at, updated_at)
          select gen_random_uuid(), id,
                 jsonb_build_object('sub', id::text, 'email', email),
                 'email', email, now(), now(), now()
          from new_user returning user_id
        )
        select id, email from new_user;
        """
    )
    rows = mgmt_sql(
        f"select id, email_confirmed_at is not null as confirmed from auth.users where email = '{REVIEWER_EMAIL}';")
    log("评审账号创建(邮箱已确认)", len(rows) == 1 and rows[0]["confirmed"], REVIEWER_EMAIL)
    reviewer_id = rows[0]["id"]

    # 2) 登录并确认触发器产物
    token, user_id = login(REVIEWER_EMAIL, password)
    log("评审账号可正常登录", bool(token) and user_id == reviewer_id)
    status, profiles = rest(f"profiles?id=eq.{reviewer_id}&select=id,email,display_name", token)
    status2, spaces = rest(f"spaces?owner_id=eq.{reviewer_id}&select=id,name,is_default", token)
    log("注册触发器已创建资料与默认工作区",
        status == 200 and len(profiles) == 1 and status2 == 200 and len(spaces) == 1 and spaces[0]["is_default"],
        f"资料 {profiles[0]['display_name'] if profiles else None} / 工作区 {spaces[0]['name'] if spaces else None}")
    space_id = spaces[0]["id"]

    # 3) 隔离验证:评审账号只能看到自己的数据,公共表只读,越权写入被拒
    status3, convs = rest("conversations?select=id,user_id", token)
    status4, projects = rest("projects?select=id,user_id", token)
    status5, msgs = rest("messages?select=id,conversation_id", token)
    convs = convs if isinstance(convs, list) else []
    projects = projects if isinstance(projects, list) else []
    msgs = msgs if isinstance(msgs, list) else []
    own_convs = {row["id"] for row in convs if row["user_id"] == reviewer_id}
    own = (all(row["user_id"] == reviewer_id for row in convs)
           and all(row["user_id"] == reviewer_id for row in projects)
           and all(row["conversation_id"] in own_convs for row in msgs))
    log("会话/项目/消息仅可见本人数据(RLS)",
        status3 == 200 and status4 == 200 and status5 == 200 and own,
        f"会话 {len(convs)} / 项目 {len(projects)} / 消息 {len(msgs)}")

    other = mgmt_sql(f"select user_id from projects where user_id <> '{reviewer_id}' limit 1;")
    other_user_id = other[0]["user_id"] if other else None
    owner_projects = rest(f"projects?user_id=eq.{other_user_id}&select=id", token)
    log("越权查询他人(真实账号)项目返回空集",
        other_user_id is not None and owner_projects[0] == 200 and owner_projects[1] == [],
        f"目标账号 {other_user_id} | HTTP {owner_projects[0]} 命中 {len(owner_projects[1] or [])}")
    other_convs = rest(f"conversations?user_id=eq.{other_user_id}&select=id", token)
    log("越权查询他人会话返回空集",
        other_convs[0] == 200 and other_convs[1] == [], f"HTTP {other_convs[0]} 命中 {len(other_convs[1] or [])}")

    status6, community = rest("community_apps?select=id,title&limit=3", token)
    log("公共表(社区应用)对评审账号只读可见", status6 == 200 and len(community or []) >= 1,
        f"HTTP {status6} 命中 {len(community or [])}")
    status7, _write_public = rest("community_apps", token, {
        "method": "POST", "body": json.dumps({"title": "T34 越权写入"}).encode(),
        "headers": {"Prefer": "return=representation"},
    })
    log("公共表写入被 RLS 拒绝(无写策略)", status7 >= 400 and status7 != 400,
        f"HTTP {status7}(401/403 = 策略拒绝;400 = 请求体非法)")

    # 4) 样本数据:以评审账号身份走原子 RPC 建一个项目 + v1,便于直接查看版本链
    status8, created = rest("projects", token, {
        "method": "POST",
        "body": json.dumps({
            "user_id": reviewer_id, "space_id": space_id, "name": "T34 评审样本应用",
            "source": "created", "description": "T34 评审账号自带样本(原子版本 RPC 写入)",
            "app_html": "<!doctype html><html><head><title>T34 Reviewer Sample</title></head>"
                        "<body><h1>T34 Reviewer Sample</h1><p>评审样本应用</p></body></html>",
        }).encode(),
        "headers": {"Prefer": "return=representation"},
    })
    log("评审账号可创建项目", status8 == 201 and len(created or []) == 1, f"HTTP {status8}")
    sample_project_id = created[0]["id"] if created else None
    if sample_project_id:
        status9, ver = rest("rpc/app_write_project_version", token, {
            "method": "POST",
            "body": json.dumps({
                "p_project_id": sample_project_id, "p_source": "generation", "p_label": "评审样本 v1",
                "p_app_html": created[0]["app_html"],
            }).encode(),
        })
        log("评审账号可经原子 RPC 写入 v1 版本快照", status9 < 300 and int(ver) == 1, f"HTTP {status9} 返回 {ver}")

    evidence.update({
        "email": REVIEWER_EMAIL,
        "userId": reviewer_id,
        "defaultSpace": spaces[0]["name"] if spaces else None,
        "sampleProjectId": sample_project_id,
        "validHours": VALID_HOURS,
        "validDays": VALID_HOURS // 24,
        "createdAt": created_at.isoformat(),
        "expiresAt": expires_at,
        "projectRef": PROJECT_REF,
        "supabaseUrl": URL,
        "previewUrl": "http://localhost:3000",
        "loginUrl": "http://127.0.0.1:8899/go",
    })

    revoke_sql = f"""-- T34 评审账号到期回收脚本(幂等,可重复执行)
-- 账号:    {REVIEWER_EMAIL}
-- 创建时间(UTC): {created_at.strftime('%Y-%m-%d %H:%M:%S')}
-- 到期时间(UTC): {expires_dt.strftime('%Y-%m-%d %H:%M:%S')}  (自创建起 7 天 / {VALID_HOURS} 小时)
--
-- 使用说明:到期后直接整段执行本脚本即可彻底删除账号及其全部数据;
--           重复执行不会报错,计数会稳定为 0,可作为幂等核验。

begin;

-- 1) 彻底删除(级联删除资料、工作区、会话、消息、项目与版本快照)
with removed as (
  delete from auth.users where email = '{REVIEWER_EMAIL}' returning id
)
select count(*) as auth_users_deleted from removed;

commit;

-- 2) 幂等核验:两个计数均应为 0
select
  (select count(*) from auth.users where email = '{REVIEWER_EMAIL}') as remaining_users,
  (select count(*) from profiles where email = '{REVIEWER_EMAIL}')   as remaining_profiles;

-- 可选:仅临时禁用(可逆),不删除数据
-- update auth.users set banned_until = now() + interval '100 years' where email = '{REVIEWER_EMAIL}';
-- update auth.users set banned_until = null where email = '{REVIEWER_EMAIL}';
"""
    os.makedirs(REPORT_DIR, exist_ok=True)
    report_path = os.path.join(REPORT_DIR, "t34-reviewer-account.json")
    with open(report_path, "w", encoding="utf-8") as fh:
        json.dump({"steps": steps, "evidence": evidence,
                   "passed": sum(1 for s in steps if s["ok"]), "total": len(steps)},
                  fh, ensure_ascii=False, indent=2)
    revoke_path = os.path.join(REPORT_DIR, "t34-reviewer-revoke.sql")
    with open(revoke_path, "w", encoding="utf-8") as fh:
        fh.write(revoke_sql)

    passed = sum(1 for s in steps if s["ok"])
    # 凭据不落仓库:仅写入 /tmp(不纳入版本控制),仓库内报告只保留邮箱、有效期与隔离证据
    creds_path = "/tmp/t34-reviewer-credentials.txt"
    with open(creds_path, "w", encoding="utf-8") as fh:
        fh.write(
            f"邮箱 {REVIEWER_EMAIL}\n"
            f"密码 {password}\n"
            f"创建时间(UTC) {created_at.strftime('%Y-%m-%d %H:%M:%S')}\n"
            f"到期时间(UTC) {expires_dt.strftime('%Y-%m-%d %H:%M:%S')}(有效期 7 天)\n"
            f"登录地址 http://localhost:3000\n"
            f"回收脚本 app/backend/reports/t34-reviewer-revoke.sql\n"
        )
    print(f"\nT34 评审账号:{passed}/{len(steps)} PASS")
    print(f"邮箱 {REVIEWER_EMAIL}\n密码 {password}\n有效期至(UTC) {expires_at}")
    print(f"报告 {report_path}\n回收脚本 {revoke_path}\n凭据 {creds_path}(不纳入版本控制)")
    return 0 if passed == len(steps) else 1


if __name__ == "__main__":
    time.sleep(0.2)
    raise SystemExit(main())
