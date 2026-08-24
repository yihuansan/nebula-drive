import path from 'node:path';

/**
 * 把用户提供的相对路径安全解析到 root 内；越界返回 null。
 *
 * 规则：
 * - 拒绝绝对路径（Windows `C:\` 和 POSIX `/` 开头）。
 * - 用 `path.resolve(root, userPath)` 后，验证结果必须以 `root + path.sep` 开头（或等于 root）。
 * - 处理 `%2F`、`..`、反斜杠等。
 *
 * @param userPath 用户提供的相对路径（如 `a/b/c.txt`、`/a/b/c.txt`）。
 * @param root 存储根目录（绝对路径）。
 * @returns 解析后的绝对路径；越界返回 null。
 */
export function safeRelPath(userPath: string, root: string): string | null {
  if (!userPath || typeof userPath !== 'string') return null;

  // 规范化：去掉前导斜杠，把 %2F 替换为 /
  const normalized = userPath.replace(/%2F/gi, '/').replace(/^\//, '');

  // 拒绝绝对路径（Windows 盘符 或 POSIX /）
  if (path.isAbsolute(normalized)) return null;

  const rootResolved = path.resolve(root);
  const full = path.resolve(rootResolved, normalized);

  // 验证 full 在 root 内
  if (full !== rootResolved && !full.startsWith(rootResolved + path.sep)) return null;

  return full;
}
