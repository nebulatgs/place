import { useEffect, useRef } from "react";

export default function Home() {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	useEffect(() => {
		const canvas = canvasRef?.current;
		if (!canvas) return;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		const id = ctx.createImageData(1, 1);
		const d = id.data;

		const socket = new WebSocket("ws://localhost:4000/ws/canvas");
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
			canvas.onclick = (ev) => {
				const { x, y } = getCursorPosition(canvas, ev);
				sendPixel(x, y, 0xffffffff);

				d[0] = 255;
				d[1] = 255;
				d[2] = 255;
				d[3] = 255;
				ctx.putImageData(id, x, y);
			};
		});
	}, [canvasRef]);
	return (
		<div className='flex max-h-screen bg-green-400'>
			<div className='flex w-full'>
				<canvas
					width='1000'
					height='1000'
					className='h-full aspect-square bg-black'
					ref={canvasRef}
				></canvas>
				<div className='p-4 w-full flex flex-col'>
					<h1 className='text-3xl font-mono text-center mb-8'>
						r/place clone by nebula
					</h1>
					<p className='text-xl font-mono'>Click to place pixels </p>
				</div>
			</div>
		</div>
	);
}
