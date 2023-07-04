export interface IGarageDoorControllerConfig {
    actuatorPin: number;
    downStatePin: number;
    upStatePin: number;
    buttonContactTimeMs: number;
    doorCheckDelaySec: number;
    tfLunaSerialPort: string;
    tfLunaBuadRate: number;
    tfLunaSampleRate: number;
    tfLunaSerialParserLog: boolean;
}

export const enum GPIOState {
    LOW = 0,
    HIGH = 1
}

export enum GarageDoorId {
    GarageDoor1 = 0,
    GarageDoor2 = 1,
    GarageDoor3 = 2
}

export enum GarageDoorStatus {
    Unknown = 'unknown',
    Open = 'open',
    Closed = 'closed'
}

export interface IGarageDoorStatus {
    status: GarageDoorStatus;
}

export enum GarageDoorAction {
    Actuate = 'actuate',
    Open = 'open',
    Close = 'close',
    Check = 'check',
    StartMeasurment = 'startMeasurement',
    StopMeasurement = 'stopMeasurement'
}

export interface ICarPortServiceRequest {
    garageDoorId: GarageDoorId;
    action: GarageDoorAction;
}

export interface ICarPortServiceResponse {
    succeeded: boolean;
    message: string;
    status: GarageDoorStatus;
}

export interface ITFLunaStatus {
    restoreDefaultSettingsStatus: number;
    saveCurrentSettingsStatus: number;
    baudRate: number;
    sampleRate: number;
    version: string;
    measurement: number;
}

export const TFLunaCommandHeader = [0x5A];
export const TFLunaMeasureHeader = [0x59, 0x59];
export const TFLunaRestoreDefaultSettingsCommand = 0x10;
export const TFLunaRestoreDefaultSettingsPrefix = [0x5A, 0x04, TFLunaRestoreDefaultSettingsCommand];
export const TFLunaSaveCurrentSettingsCommand = 0x11;
export const TFLunaSaveCurrentSettingsPrefix = [0x5A, 0x04, TFLunaSaveCurrentSettingsCommand];
export const TFLunaSetBaudRateCommand = 0x06;
export const TFLunaSetBaudRatePrefix = [0x5A, 0x08, TFLunaSetBaudRateCommand];
export const TFLunaSetSampleRateCommand = 0x03;
export const TFLunaSetSampleRatePrefix = [0x5A, 0x06, TFLunaSetSampleRateCommand];
export const TFLunaGetVersionCommand = 0x14;
export const TFLunaGetVersionPrefix = [0x5A, 0x04, TFLunaGetVersionCommand];
export const TFLunaMeasurementCommand = 0x04;
export const TFLunaMeasurementPrefix = [0x5A, 0x04, TFLunaMeasurementCommand];

export interface ITFLunaResponse {
    commandId: number;
}

export interface ITFLunaRestoreDefaultSettingsResponse extends ITFLunaResponse {
    status: number;
}

export interface ITFLunaSaveCurrentSettingsResponse extends ITFLunaResponse {
    status: number;
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
