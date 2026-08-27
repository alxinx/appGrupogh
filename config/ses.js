import { SESClient } from "@aws-sdk/client-ses";

// Sin credenciales explícitas: la instancia EC2 corre con el IAM Role
// grupogh-app-ec2-role, que tiene ses:SendEmail/ses:SendRawEmail sobre la identidad
// notificaciones.grupogh.co. El SDK las toma solo del instance metadata (mismo patrón
// de "sin secretos en el repo" que ya se sigue en el resto del proyecto).
const sesClient = new SESClient({ region: "us-east-1" });

export default sesClient;
