import { SessionProvider } from "next-auth/react";
import { AppProps } from "next/app";
import Head from "next/head";
import "../styles/index.css";

function MyApp({ Component, pageProps: { session, ...pageProps } }: AppProps) {
	return (
		<>
			<Head>
				<title>NextJS TailwindCSS TypeScript Starter</title>
				<meta name='viewport' content='initial-scale=1.0, width=device-width' />
			</Head>
			<SessionProvider session={session}>
				<Component {...pageProps} />
			</SessionProvider>
		</>
	);
}

export default MyApp;
