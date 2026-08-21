import nodemailer from 'nodemailer';
import { getSetting } from './settings.service.js';
import { config } from '../config.js';

/**
 * SMTP 邮件服务：
 * - 配置来源：系统设置（smtp* 键）
 * - 用途：用户注册欢迎邮件、SMTP 连通性测试
 * - 设计原则：SMTP 未启用时静默跳过；发送失败不阻断主流程（注册等）。
 */

export interface SmtpConfig {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  from: string;
  fromName: string;
}

/** 从系统设置读取 SMTP 配置 */
export function getSmtpConfig(): SmtpConfig {
  const port = Number(getSetting('smtpPort') || '');
  return {
    enabled: getSetting('smtpEnabled') === 'true',
    host: (getSetting('smtpHost') || '').trim(),
    port: Number.isFinite(port) && port > 0 ? port : 465,
    secure: getSetting('smtpSecure') === 'true',
    user: (getSetting('smtpUser') || '').trim(),
    password: (getSetting('smtpPassword') || '').trim(),
    from: (getSetting('smtpFrom') || getSetting('smtpUser') || '').trim(),
    fromName: (getSetting('smtpFromName') || '').trim(),
  };
}

/** SMTP 是否启用 */
export function isSmtpEnabled(): boolean {
  return getSmtpConfig().enabled;
}

/** 是否已具备可发送条件（启用 + 有服务器 + 有发件地址） */
export function isSmtpConfigured(): boolean {
  const c = getSmtpConfig();
  return c.enabled && !!c.host && !!c.from;
}

function buildTransporter(cfg: SmtpConfig) {
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure, // true = 465 强制 TLS
    ignoreTLS: !cfg.secure, // 非强制 TLS（如 587 STARTTLS）时忽略证书校验
    auth: cfg.user ? { user: cfg.user, pass: cfg.password } : undefined,
    tls: {
      // 自签 / 内网 SMTP 常无有效证书，放宽校验保证可用
      rejectUnauthorized: false,
    },
  });
}

function formatFrom(cfg: SmtpConfig): string {
  return cfg.fromName ? `"${cfg.fromName}" <${cfg.from}>` : cfg.from;
}

/**
 * 发送邮件。
 * 返回 { ok, error? }：
 * - SMTP 未启用 → { ok: true }（静默跳过，视为无邮件需求）
 * - 已启用但配置不全 → { ok: false, error }
 * - 发送异常 → { ok: false, error }
 */
export async function sendMail(
  to: string,
  subject: string,
  html: string,
): Promise<{ ok: boolean; error?: string }> {
  const cfg = getSmtpConfig();
  if (!cfg.enabled) return { ok: true };
  if (!cfg.host || !cfg.from) {
    return { ok: false, error: 'SMTP 未配置（缺少服务器地址或发件邮箱）' };
  }
  try {
    const transporter = buildTransporter(cfg);
    await transporter.sendMail({
      from: formatFrom(cfg),
      to,
      subject,
      html,
    });
    return { ok: true };
  } catch (e: any) {
    const msg = e?.message || String(e);
    console.error('[email] 发送失败:', msg);
    return { ok: false, error: msg };
  }
}

/** 简易 HTML 外壳（品牌色 + 居中卡片） */
function wrapHtml(inner: string): string {
  const appName = getSetting('appName') || 'NebulaDrive 星云网盘';
  return `<!DOCTYPE html>
<html lang="zh-CN">
  <head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
  <body style="margin:0;padding:0;background:#0b1020;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,'PingFang SC','Microsoft YaHei',sans-serif;">
    <div style="max-width:560px;margin:0 auto;padding:32px 16px;">
      <div style="border-radius:16px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);padding:28px;">
        <h1 style="margin:0 0 8px;font-size:20px;color:#7c8cff;">${appName}</h1>
        ${inner}
      </div>
      <p style="text-align:center;margin-top:18px;font-size:12px;color:#6b7280;">此邮件由 ${appName} 系统自动发送，请勿直接回复。</p>
    </div>
  </body>
</html>`;
}

/** 用户注册欢迎邮件 */
export async function sendWelcomeEmail(
  to: string,
  username: string,
  displayName: string,
): Promise<{ ok: boolean; error?: string; skipped?: boolean }> {
  const cfg = getSmtpConfig();
  if (!cfg.enabled) return { ok: true, skipped: true };
  const appName = getSetting('appName') || 'NebulaDrive 星云网盘';
  const appUrl = config.appUrl;
  const name = displayName || username;
  const inner = `
    <p style="margin:0 0 16px;font-size:15px;color:#e5e7eb;">你好，<strong>${escapeHtml(name)}</strong>：</p>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.7;color:#cbd5e1;">
      欢迎加入 <strong>${escapeHtml(appName)}</strong>！你的账号已创建成功，登录信息如下：
    </p>
    <table style="border-collapse:collapse;font-size:14px;color:#e5e7eb;">
      <tr><td style="padding:6px 12px 6px 0;color:#9ca3af;">账号</td><td style="padding:6px 0;font-weight:600;">${escapeHtml(username)}</td></tr>
      <tr><td style="padding:6px 12px 6px 0;color:#9ca3af;">邮箱</td><td style="padding:6px 0;">${escapeHtml(to)}</td></tr>
      <tr><td style="padding:6px 12px 6px 0;color:#9ca3af;">登录地址</td><td style="padding:6px 0;"><a href="${appUrl}" style="color:#7c8cff;">${appUrl}</a></td></tr>
    </table>
    <p style="margin:20px 0 0;font-size:13px;color:#9ca3af;">请妥善保管账号密码，如有疑问请联系管理员。</p>
  `;
  return sendMail(to, `欢迎加入 ${appName}`, wrapHtml(inner));
}

/** SMTP 测试邮件 */
export async function sendTestEmail(to: string): Promise<{ ok: boolean; error?: string }> {
  const appName = getSetting('appName') || 'NebulaDrive 星云网盘';
  const inner = `
    <p style="margin:0 0 16px;font-size:15px;color:#e5e7eb;">你好：</p>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.7;color:#cbd5e1;">
      这是一封 <strong>SMTP 测试邮件</strong>。如果你能收到这封邮件，说明 ${escapeHtml(appName)} 的邮件服务配置成功，可用于发送注册通知等邮件。
    </p>
    <p style="margin:0;font-size:13px;color:#9ca3af;">发送时间：${new Date().toLocaleString('zh-CN', { hour12: false })}</p>
  `;
  return sendMail(to, `[${appName}] SMTP 测试邮件`, wrapHtml(inner));
}

function escapeHtml(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
