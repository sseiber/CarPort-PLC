import { ComposeManifest } from 'spryly';
import { IGarageDoorControllerConfig } from './models/carportTypes';
import { OPCUAServerOptions } from 'node-opcua';
import { IAssetRootConfig } from './models/opcuaServerTypes';

const DefaultPort = 9092;
const PORT = process.env.PORT || process.env.port || process.env.PORT0 || process.env.port0 || DefaultPort;

export function manifest(garageDoorControllerConfigs: IGarageDoorControllerConfig[], serverConfig: OPCUAServerOptions, assetRootConfig: IAssetRootConfig): ComposeManifest {
    return {
        server: {
            port: PORT,
            app: {
                carport: {
                    garageDoorControllerConfigs,
                    serverConfig,
                    assetRootConfig
                }
            }
        },
        services: [
            './services'
        ],
        plugins: [
            ...[
                {
                    plugin: './apis'
                }
            ]
        ]
    };
}

