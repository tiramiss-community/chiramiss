import { startOrigin } from './origin.ts';

const origin = await startOrigin({
	httpsPort: Number(process.env.ORIGIN_HTTPS_PORT ?? 443),
	controlPort: Number(process.env.ORIGIN_CONTROL_PORT ?? 9000),
	host: '0.0.0.0',
	certDir: process.env.ORIGIN_CERT_DIR ?? '/certs',
});

process.on('SIGTERM', () => {
	void origin.close().then(() => process.exit(0));
});
