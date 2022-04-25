import { useEffect, useRef, useState } from "react";

/**
 * Converts an HSL color value to RGB. Conversion formula
 * adapted from http://en.wikipedia.org/wiki/HSL_color_space.
 * Assumes h, s, and l are contained in the set [0, 1] and
 * returns r, g, and b in the set [0, 255].
 */
function hslToRgb([h, s, l]: [number, number, number]) {
	let r: number, g: number, b: number;

	if (s == 0) {
		r = g = b = l; // achromatic
	} else {
		const hue2rgb = (p: number, q: number, t: number) => {
			if (t < 0) t += 1;
			if (t > 1) t -= 1;
			if (t < 1 / 6) return p + (q - p) * 6 * t;
			if (t < 1 / 2) return q;
			if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
			return p;
		};

		const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
		const p = 2 * l - q;
		r = hue2rgb(p, q, h + 1 / 3);
		g = hue2rgb(p, q, h);
		b = hue2rgb(p, q, h - 1 / 3);
	}

	return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

export default function Home() {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const colors = [
		[0 / 16, 0.8, 0.6],
		[1 / 16, 0.8, 0.6],
		[2 / 16, 0.8, 0.6],
		[3 / 16, 0.8, 0.6],
		[4 / 16, 0.8, 0.6],
		[5 / 16, 0.8, 0.6],
		[6 / 16, 0.8, 0.6],
		[7 / 16, 0.8, 0.6],
		[8 / 16, 0.8, 0.6],
		[9 / 16, 0.8, 0.6],
		[10 / 16, 0.8, 0.6],
		[11 / 16, 0.8, 0.6],
		[12 / 16, 0.8, 0.6],
		[13 / 16, 0.8, 0.6],
		[14 / 16, 0.8, 0.6],
		[15 / 16, 0.8, 0.6],
	].map(hslToRgb);

	let [color, setColor] = useState(0xffffffff);
	let [socket, setSocket] = useState<WebSocket | null>(null);

	useEffect(() => {
		const canvas = canvasRef?.current;
		if (!canvas) return;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		const id = ctx.createImageData(1, 1);
		const d = id.data;

		const socket = new WebSocket("wss://place-api.nebsplay.space/ws/canvas");

		// Listen for messages
		socket.addEventListener("message", async (event) => {
			const blob = event.data as Blob;
			if (!blob?.arrayBuffer) return;
			const buffer = await blob.arrayBuffer();
			if (buffer.byteLength !== 1000 * 1000 * 4) {
				const x = new Uint16Array(buffer).slice(0, 2)[0];
				const y = new Uint16Array(buffer).slice(0, 2)[1];
				const color = new Uint8ClampedArray(
					new Uint32Array(buffer).slice(1, 2).buffer
				);
				d.set(color, 0);
				ctx.putImageData(id, x, y);
				return;
			}
			ctx.putImageData(
				new ImageData(new Uint8ClampedArray(buffer), 1000, 1000),
				0,
				0
			);
		});
		setSocket(socket);
	}, [canvasRef]);

	useEffect(() => {
		if (!socket) return;
		const canvas = canvasRef?.current;
		if (!canvas) return;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		const id = ctx.createImageData(1, 1);
		const d = id.data;
		const sendPixel = (x: number, y: number, col: number) => {
			const coords = new Uint16Array([x, y]);
			const color = new Uint32Array([col]);
			const tmp = new Uint8Array(coords.byteLength + color.byteLength);
			tmp.set(new Uint8Array(coords.buffer), 0);
			tmp.set(new Uint8Array(color.buffer), color.byteLength);
			socket.send(tmp);
		};
		const getCursorPosition = (
			canvas: HTMLCanvasElement,
			event: MouseEvent
		) => {
			const rect = canvas.getBoundingClientRect();
			let x = event.clientX - rect.left;
			let y = event.clientY - rect.top;
			x *= 1000 / rect.width;
			y *= 1000 / rect.height;
			return { x, y };
		};
		canvas.onclick = (ev) => {
			const { x, y } = getCursorPosition(canvas, ev);
			sendPixel(x, y, color);

			new Uint32Array(d.buffer).set([color], 0);
			ctx.putImageData(id, x, y);
		};
	}, [canvasRef, color]);

	return (
		<div className='flex min-h-screen bg-green-400'>
			<div className='flex flex-col lg:flex-row w-full'>
				<canvas
					width='1000'
					height='1000'
					className='h-full lg:h-screen lg:w-full aspect-square bg-black'
					ref={canvasRef}
				></canvas>
				<div className='p-4 w-full flex flex-col'>
					<h1 className='text-3xl font-mono text-center mb-8'>
						r/place clone by nebula
					</h1>
					<p className='text-xl font-mono'>Click to place pixels </p>
					<div className='flex w-full justify-center flex-wrap lg:flex-nowrap'>
						{colors.map((c) => (
							<div
								style={{ background: `rgb(${c.join(",")})` }}
								className='w-1/4 lg:w-full aspect-square'
								onClick={() => {
									setColor(
										new Uint32Array(new Uint8Array([...c, 255]).buffer)[0]
									);
								}}
							></div>
						))}
					</div>
				</div>
			</div>
		</div>
	);
}
