export interface IAppConfig {
    sampleFrequencyMs: number;
    log: (tags: any, message: any) => void;
}

export interface ITFLunaResponse {
    header: string;
    length: number;
    checksum: string;
    commandId: string;
}

export interface ITFLunaBaudResponse extends ITFLunaResponse {
    baudRate: number;
}

export interface ITFLunaSampleRateResponse extends ITFLunaResponse {
    sampleRate: number;
}

export interface ITFLunaVersionResponse extends ITFLunaResponse {
    version: string;
}

export interface ITFLunaMeasureResponse extends ITFLunaResponse {
    distCm: number;
    amp: number;
    tempC: string;
}
