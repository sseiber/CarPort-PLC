import { ComposeManifest } from 'spryly';
import { IGarageDoorControllerConfig } from './models/carportTypes';

const DefaultPort = 9092;
const PORT = process.env.PORT || process.env.port || process.env.PORT0 || process.env.port0 || DefaultPort;

export function manifest(carportServiceConfigs: IGarageDoorControllerConfig[]): ComposeManifest {
    return {
        server: {
            port: PORT,
            app: {
                carport: carportServiceConfigs
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
