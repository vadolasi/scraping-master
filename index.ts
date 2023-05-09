import dotenv from "dotenv"
import express from "express"
import cors from "cors"
import helmet from "helmet"
import morgan from "morgan"
import { SQS } from "@aws-sdk/client-sqs"
import { EventEmitter } from "events"
import { randomUUID } from "crypto"

const emitter = new EventEmitter()

dotenv.config()

const sqs = new SQS({
  region: "sa-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!
  }
})

const app = express()

app.use(cors())
app.use(helmet())
app.use(morgan("combined"))
app.use(express.json({ limit: "100mb" }))
app.use(express.urlencoded({ extended: true }))

app.get("/", async (req, res) => {
  let { url, selector, javascript, wait, block } = req.query

  if (block && !Array.isArray(block)) {
    block = [block as string]
  } else if (!block) {
    block = []
  }

  if (!url) {
    return res.status(400).send("Missing url query parameter")
  }

  const id = randomUUID()

  await sqs.sendMessage({
    QueueUrl: process.env.SQS_URL,
    MessageBody: JSON.stringify({
      id,
      url,
      selector,
      javascript,
      wait,
      block
    })
  })

  const result = await new Promise<{ success: boolean, content: string, error: string }>(resolve => {
    emitter.once(id, resolve)
  })
  console.log(result)

  if (result.success) {
    res.send(result.content)
  } else {
    res.status(500).send(result.error)
  }
})

app.post("/webhook", async (req, res) => {
  const { success, error, content, id } = req.body

  emitter.emit(id, { success, error, content })

  res.send("ok")
})

const port = parseInt(process.env.PORT || "3000")

app.listen(port, () => {
  console.log(`Listening on port ${port}`)
})
