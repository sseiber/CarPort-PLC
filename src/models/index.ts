export {
    ObserveTarget,
    ActiveObserveTargets,
    ActiveObserveTargetsDefaults,
    IObserveRequest,
    ICarportConfig,
    IMotionModelConfig,
    ITFLunaConfig,
    IGarageDoorControllerConfig,
    IGarageDoorStatus,
    ICarportServiceRequest,
    GarageDoorAction,
    LowGpioState,
    HighGpioState,
    GarageDoorId1,
    GarageDoorId2,
    GarageDoorId3,
    GarageDoorStatus,
    ITFLunaStatus,
    TFLunaRestoreDefaultSettingsCommand,
    TFLunaRestoreDefaultSettingsPrefix,
    TFLunaSaveCurrentSettingsCommand,
    TFLunaSaveCurrentSettingsPrefix,
    TFLunaSetBaudRateCommand,
    TFLunaSetBaudRatePrefix,
    TFLunaSetSampleRateCommand,
    TFLunaSetSampleRatePrefix,
    TFLunaSoftResetPrefix,
    TFLunaGetVersionCommand,
    TFLunaGetVersionPrefix,
    TFLunaMeasurementPrefix,
    ITFLunaResponse,
    ITFLunaRestoreDefaultSettingsResponse,
    ITFLunaSaveCurrentSettingsResponse,
    ITFLunaSoftResetResponse,
    ITFLunaBaudResponse,
    ITFLunaSampleRateResponse,
    ITFLunaVersionResponse,
    ITFLunaMeasureResponse,
    TFLunaMeasurementCommand,
    IServiceResponse,
    IServiceErrorMessage,
    IServiceReply
} from './carportTypes.js';

import ActiveObserveTargetsSchema from './schemas/ActiveObserveTargetsSchema.json' with { type: 'json' };
import IObserveRequestSchema from './schemas/IObserveRequestSchema.json' with { type: 'json' };
import ICarportConfigSchema from './schemas/ICarportConfigSchema.json' with { type: 'json' };
import IMotionModelConfigSchema from './schemas/IMotionModelConfigSchema.json' with { type: 'json' };
import ITFLunaConfigSchema from './schemas/ITFLunaConfigSchema.json' with { type: 'json' };
import IGarageDoorControllerConfigSchema from './schemas/IGarageDoorControllerConfigSchema.json' with { type: 'json' };
import IGarageDoorStatusSchema from './schemas/IGarageDoorStatusSchema.json' with { type: 'json' };
import ICarportServiceRequestSchema from './schemas/ICarportServiceRequestSchema.json' with { type: 'json' };
import ITFLunaStatusSchema from './schemas/ITFLunaStatusSchema.json' with { type: 'json' };
import ITFLunaResponseSchema from './schemas/ITFLunaResponseSchema.json' with { type: 'json' };
import ITFLunaRestoreDefaultSettingsResponseSchema from './schemas/ITFLunaRestoreDefaultSettingsResponseSchema.json' with { type: 'json' };
import ITFLunaSaveCurrentSettingsResponseSchema from './schemas/ITFLunaSaveCurrentSettingsResponseSchema.json' with { type: 'json' };
import ITFLunaSoftResetResponseSchema from './schemas/ITFLunaSoftResetResponseSchema.json' with { type: 'json' };
import ITFLunaBaudResponseSchema from './schemas/ITFLunaBaudResponseSchema.json' with { type: 'json' };
import ITFLunaSampleRateResponseSchema from './schemas/ITFLunaSampleRateResponseSchema.json' with { type: 'json' };
import ITFLunaVersionResponseSchema from './schemas/ITFLunaVersionResponseSchema.json' with { type: 'json' };
import IServiceResponseSchema from './schemas/IServiceResponseSchema.json' with { type: 'json' };
import ITFLunaMeasureResponseSchema from './schemas/ITFLunaMeasureResponseSchema.json' with { type: 'json' };
import IServiceErrorMessageSchema from './schemas/IServiceErrorMessageSchema.json' with { type: 'json' };
export {
    ActiveObserveTargetsSchema,
    IObserveRequestSchema,
    ICarportConfigSchema,
    IMotionModelConfigSchema,
    ITFLunaConfigSchema,
    IGarageDoorControllerConfigSchema,
    IGarageDoorStatusSchema,
    ICarportServiceRequestSchema,
    ITFLunaStatusSchema,
    ITFLunaResponseSchema,
    ITFLunaRestoreDefaultSettingsResponseSchema,
    ITFLunaSaveCurrentSettingsResponseSchema,
    ITFLunaSoftResetResponseSchema,
    ITFLunaBaudResponseSchema,
    ITFLunaSampleRateResponseSchema,
    ITFLunaVersionResponseSchema,
    ITFLunaMeasureResponseSchema,
    IServiceResponseSchema,
    IServiceErrorMessageSchema
};
