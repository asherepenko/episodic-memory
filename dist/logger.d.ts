export declare function getLogPath(): string;
export declare const log: {
    info(msg: string): void;
    warn(msg: string): void;
    error(msg: string): void;
    debug(msg: string): void;
};
export declare function closeLog(): void;
