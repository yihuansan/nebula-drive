/** 第三方包类型垫片：qrcode 无自带 TS 类型声明 */
declare module 'qrcode' {
  export interface QRCodeToDataURLOptions {
    width?: number;
    margin?: number;
    color?: { dark?: string; light?: string };
    errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
  }
  export function toDataURL(text: string, options?: QRCodeToDataURLOptions): Promise<string>;
  export function toString(text: string, options?: Record<string, unknown>): Promise<string>;
  const QRCode: {
    toDataURL: typeof toDataURL;
    toString: typeof toString;
  };
  export default QRCode;
}
