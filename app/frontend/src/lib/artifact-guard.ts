/**
 * T32 产物守卫:生成产物在「成为当前生效版本」之前必须通过可用性校验。
 *
 * 背景——T31 已保证「项目内容 + 版本快照」同事务写入,不会出现半写状态;
 * 但产物本身是否可用此前不做校验:模型偶发输出空内容、被截断的文档(缺 `</html>`)
 * 或内联脚本语法错误时,这些产物仍会照常落库,于是「当前生效版本」变成一份打不开的应用。
 *
 * 本模块与 Edge Function 的语法自检同口径(提取内联 `<script>` 用 `new Function` 纯编译校验,
 * 只编译不执行函数体),校验不通过的产物由调用方按「本轮失败」处理:
 * 不落库、不切换预览与源码,当前生效版本保持上一次成功结果。
 */

/** 提取内联脚本做纯语法校验(只编译不执行),规则与 Edge Function findScriptSyntaxErrors 一致 */
export function findInlineScriptSyntaxErrors(html: string): string[] {
  const errors: string[] = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null = re.exec(html);
  while (match !== null) {
    const attrs = match[1] ?? '';
    const code = match[2] ?? '';
    match = re.exec(html);
    // 外链脚本(无法就地校验)与模块/JSON 数据块跳过,避免误判
    if (/\bsrc\s*=/i.test(attrs)) continue;
    if (/type\s*=\s*["']?(module|application\/json)/i.test(attrs)) continue;
    if (!code.trim()) continue;
    try {
      // eslint-disable-next-line no-new-func
      new Function(code);
    } catch (error) {
      const message = String(error);
      if (message.includes('SyntaxError')) errors.push(message.slice(0, 160));
    }
  }
  return errors;
}

export interface ArtifactVerdict {
  ok: boolean;
  /** 不通过时的原因(用于失败卡与日志,便于定位是空产物、截断还是语法错误) */
  reason: string;
}

/**
 * 校验生成产物是否可用:
 * 1) 非空——空产物落库会让当前版本变成空白页;
 * 2) 文档完整——必须出现 `</html>`,否则视为被截断的半截产物;
 * 3) 内联脚本可解析——语法错误会让预览运行期直接抛错。
 */
export function validateArtifact(html: string): ArtifactVerdict {
  const source = typeof html === 'string' ? html : '';
  if (!source.trim()) {
    return { ok: false, reason: '产物为空' };
  }
  if (!/<\/html>/i.test(source)) {
    return { ok: false, reason: '产物不完整(缺少 </html> 结束标签,疑似被截断)' };
  }
  const errors = findInlineScriptSyntaxErrors(source);
  if (errors.length > 0) {
    return { ok: false, reason: `内联脚本语法错误(${errors[0]})` };
  }
  return { ok: true, reason: '' };
}
