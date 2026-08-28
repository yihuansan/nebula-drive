/** 第三方模块类型声明（无官方 @types 或类型声明缺失） */

declare module 'archiver' {
  import type { Readable } from 'node:stream';
  interface ArchiverOptions {
    stream?: boolean;
    zlib?: { level?: number };
  }
  interface EntryOptions {
    name?: string;
    prefix?: string;
    date?: Date;
    stats?: any;
  }
  interface Archiver extends Readable {
    file(src: string, opts?: EntryOptions): Archiver;
    dir(src: string, dst: string, opts?: EntryOptions): Archiver;
    glob(pattern: string, opts?: any): Archiver;
    append(src: Readable | Buffer | string, opts: EntryOptions): Archiver;
    finalize(): Promise<void>;
    on(event: string, listener: (...args: any[]) => void): this;
    pipe<T extends NodeJS.WritableStream>(dest: T): T;
  }
  function archiver(opts?: ArchiverOptions): Archiver;
  export = archiver;
}

declare module 'qrcode' {
  export function toDataURL(text: string, opts?: any): Promise<string>;
  export function toString(text: string, opts?: any): Promise<string>;
  export function toFile(path: string, text: string, opts?: any): Promise<void>;
}

declare module 'nodemailer' {
  interface Transporter {
    sendMail(opts: {
      from?: string;
      to: string;
      subject?: string;
      html?: string;
      text?: string;
    }): Promise<any>;
    verify(): Promise<true>;
  }
  interface TransportOptions {
    host?: string;
    port?: number;
    secure?: boolean;
    ignoreTLS?: boolean;
    auth?: { user?: string; pass?: string };
    tls?: { rejectUnauthorized?: boolean };
  }
  function createTransport(opts: TransportOptions): Transporter;
  export { createTransport, Transporter, TransportOptions };
}
