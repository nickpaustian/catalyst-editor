export const drawShape = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  shapeType: string = "circle",
  colour: string = "#FFFFFF"
): void => {
  switch (shapeType) {
    case "x":
      drawX(ctx, x, y, 8, colour, 2)
      break
    case "hexagon":
      drawHexagon(ctx, x, y, 5, colour, 1)
      break
    case "square":
      drawSquare(ctx, x, y, 8, colour, 1)
      break
    case "diamond":
      drawDiamond(ctx, x, y, 5, colour, 1)
      break
    case "circle":
    default:
      drawCircle(ctx, x, y, 4, colour)
      break
  }
}

export const drawCircle = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  colour: string = "#FFFFFF"
): void => {
  ctx.fillStyle = colour
  ctx.beginPath()
  ctx.arc(x, y, radius, 0, Math.PI * 2)
  ctx.fill()
}

export const drawX = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  colour: string = "#FFFFFF",
  lineWidth: number = 1
): void => {
  ctx.strokeStyle = colour
  ctx.lineWidth = lineWidth
  ctx.lineCap = "round"
  const offset = size / 2
  ctx.beginPath()
  ctx.moveTo(x - offset, y - offset)
  ctx.lineTo(x + offset, y + offset)
  ctx.stroke()

  ctx.beginPath()
  ctx.moveTo(x + offset, y - offset)
  ctx.lineTo(x - offset, y + offset)
  ctx.stroke()
}

export const drawHexagon = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  colour: string = "#FFFFFF",
  lineWidth: number = 1
): void => {
  ctx.strokeStyle = colour
  ctx.lineWidth = lineWidth
  ctx.beginPath()
  for (let i = 0; i < 6; i++) {
    const angle = (i * Math.PI) / 3
    const px = x + radius * Math.cos(angle)
    const py = y + radius * Math.sin(angle)
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.closePath()
  ctx.stroke()
}

export const drawSquare = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  colour: string = "#FFFFFF",
  lineWidth: number = 1
): void => {
  ctx.strokeStyle = colour
  ctx.lineWidth = lineWidth
  const offset = size / 2
  ctx.strokeRect(x - offset, y - offset, size, size)
}

export const drawDiamond = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  colour: string = "#FFFFFF",
  lineWidth: number = 1
): void => {
  ctx.strokeStyle = colour
  ctx.lineWidth = lineWidth
  ctx.beginPath()
  ctx.moveTo(x, y - size)
  ctx.lineTo(x + size, y)
  ctx.lineTo(x, y + size)
  ctx.lineTo(x - size, y)
  ctx.closePath()
  ctx.stroke()
}
