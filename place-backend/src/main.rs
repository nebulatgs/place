use anyhow::anyhow;
use axum::{
    extract::ws::{Message, WebSocket, WebSocketUpgrade},
    response::IntoResponse,
    routing::get,
    Extension, Router,
};
use futures_util::FutureExt;
use redis::AsyncCommands;
use std::{
    net::SocketAddr,
    sync::{atomic::AtomicU64, Arc, RwLock},
};
use tower::ServiceBuilder;
use tower_http::add_extension::AddExtensionLayer;

const CANVAS_HEIGHT: usize = 1000;
const CANVAS_WIDTH: usize = 1000;
struct Canvas {
    pixels: RwLock<Vec<[u32; CANVAS_WIDTH]>>,
    inc: AtomicU64,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    std::env::var("REDIS_URL").expect("REDIS_URL must be set");

    let client = redis::Client::open(std::env::var("REDIS_URL").unwrap()).unwrap();
    let mut con = client.get_async_connection().await.unwrap();
    let canvas = Arc::new(Canvas {
        pixels: RwLock::new(vec![[0; CANVAS_WIDTH]; CANVAS_HEIGHT]),
        inc: AtomicU64::new(0),
    });
    let indices: Vec<_> = canvas
        .pixels
        .read()
        .unwrap()
        .iter()
        .enumerate()
        .map(|(y, row)| {
            row.iter().enumerate().map(move |(x, _)| {
                (u64::try_from(y).unwrap() * u64::try_from(CANVAS_WIDTH).unwrap())
                    + u64::try_from(x).unwrap()
            })
        })
        .flatten()
        .collect();
    // let pixels: () = con
    //     .set_multiple(
    //         (0..indices.len() / 2)
    //             .map(|i| (indices[i], 0u64))
    //             .collect::<Vec<_>>()
    //             .as_slice(),
    //     )
    //     .await
    //     // .or::<anyhow::Result<u32>>(Ok(0))
    //     .unwrap();
    // let pixels: () = con
    //     .set_multiple(
    //         (indices.len() / 2..indices.len())
    //             .map(|i| (indices[i], 0u64))
    //             .collect::<Vec<_>>()
    //             .as_slice(),
    //     )
    //     .await
    //     // .or::<anyhow::Result<u32>>(Ok(0))
    //     .unwrap();
    let pixels: Vec<u32> = con.get(indices).await.unwrap();

    pixels.into_iter().enumerate().for_each(|(i, color)| {
        let row = i / CANVAS_WIDTH;
        let col = i % CANVAS_WIDTH;
        canvas.pixels.write().unwrap()[row][col] = color;
    });

    dbg!("finished loading pixels");
    let app = Router::new()
        .route("/ws/canvas", get(upgrade_canvas))
        .layer(ServiceBuilder::new().layer(AddExtensionLayer::new(canvas)));

    let addr = SocketAddr::from(([0, 0, 0, 0], 4000));
    println!("listening on {}", addr);
    axum::Server::bind(&addr)
        .serve(app.into_make_service())
        .await?;
    Ok(())
}

async fn upgrade_canvas(
    ws: WebSocketUpgrade,
    Extension(canvas): Extension<Arc<Canvas>>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| {
        handle_socket(socket, canvas).map(|f| match f {
            Ok(f) => f,
            Err(e) => eprintln!("{}", e),
        })
    })
}

async fn wait_pixel_updated(canvas: &Canvas) {
    let inc = canvas.inc.load(std::sync::atomic::Ordering::Relaxed);
    while inc == canvas.inc.load(std::sync::atomic::Ordering::Relaxed) {
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
}

async fn handle_socket(mut socket: WebSocket, canvas: Arc<Canvas>) -> anyhow::Result<()> {
    let client = redis::Client::open(std::env::var("REDIS_URL").unwrap()).unwrap();
    let mut con = client.get_async_connection().await.unwrap();

    let pixels = (&canvas)
        .pixels
        .try_read()
        .map_err(|_| anyhow!("unable to lock pixels for reading"))?
        .iter()
        .flat_map(|row| row.iter())
        .cloned()
        .map(u32::to_le_bytes)
        .flatten()
        .collect::<Vec<_>>();
    socket.send(Message::Binary(pixels)).await.unwrap();

    while let Some(poll) = futures_util::select! {
       a = socket.recv().fuse() => Some(a),
       _ = wait_pixel_updated(&canvas).fuse() => Some(None)
    } {
        if let Some(msg) = poll {
            if let Ok(msg) = msg {
                let bytes = msg.into_data();
                let x = u16::from_le_bytes(
                    bytes
                        .get(0..2)
                        .ok_or(anyhow!("x not provided"))?
                        .try_into()?,
                );
                let y = u16::from_le_bytes(
                    bytes
                        .get(2..4)
                        .ok_or(anyhow!("y not provided"))?
                        .try_into()?,
                );
                let color = u32::from_le_bytes(
                    bytes
                        .get(4..8)
                        .ok_or(anyhow!("color not provided"))?
                        .try_into()?,
                );
                dbg!(x, y, color, bytes);
                {
                    let mut lock = (&canvas)
                        .pixels
                        .try_write()
                        .map_err(|_| anyhow!("unable to lock canvas"))?;
                    let pixel = lock
                        .iter_mut()
                        .skip(y as usize)
                        .next()
                        .ok_or(anyhow!("y index out of bounds"))?
                        .iter_mut()
                        .skip(x as usize)
                        .next()
                        .ok_or(anyhow!("x index out of bounds"))?;
                    *pixel = color;
                }
                let index = (u64::from(y) * u64::try_from(CANVAS_WIDTH).unwrap()) + u64::from(x);
                canvas
                    .inc
                    .store(index, std::sync::atomic::Ordering::Relaxed);
                let _: () = con.set(index, color).await?;
            } else {
                // client disconnected
                return Ok(());
            };

            if socket.send(Message::Text("OK".into())).await.is_err() {
                // client disconnected
                return Ok(());
            }
        } else {
            // wait_pixel_updated fired
            println!("wait_pixel_updated fired");
            let index = canvas.inc.load(std::sync::atomic::Ordering::Relaxed);
            let x = u16::try_from(index % u64::try_from(CANVAS_WIDTH)?)?;
            let y = u16::try_from(index / u64::try_from(CANVAS_HEIGHT)?)?;
            let color = {
                let lock = canvas
                    .pixels
                    .try_read()
                    .map_err(|_| anyhow!("Unable to lock canvas"))?;
                *lock
                    .get(y as usize)
                    .ok_or(anyhow!("y index out of bounds"))?
                    .get(x as usize)
                    .ok_or(anyhow!("x index out of bounds"))?
            };
            let mut buf = vec![0u8; 8];
            buf[0..2].copy_from_slice(&x.to_le_bytes());
            buf[2..4].copy_from_slice(&y.to_le_bytes());
            buf[4..8].copy_from_slice(&color.to_le_bytes());
            socket.send(Message::Binary(buf)).await?;
        }
    }
    Ok(())
}
