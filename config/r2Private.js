import { S3Client } from "@aws-sdk/client-s3";
import dotenv from 'dotenv';

dotenv.config();

// Cliente separado del de config/r2.js: apunta al bucket PRIVADO (gh-pay-assets),
// con credenciales propias. Este bucket no debe tener Public Development URL ni
// dominio público asociado — todo acceso pasa por presigned URLs de corta vida
// generadas en el backend.
const r2PrivateClient = new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID_PRIVATE,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY_PRIVATE,
    },
});

export const R2_PRIVATE_BUCKET = process.env.R2_BUCKET_NAME_PRIVATE;

export default r2PrivateClient;
