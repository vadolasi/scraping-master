import dotenv from "dotenv"
import { Queue, ConnectionOptions, QueueEvents } from "bullmq"
import { Server } from "hyper-express"

dotenv.config()

const app = new Server()

const connection: ConnectionOptions = {
  host: process.env.REDIS_HOST,
  port: parseInt(process.env.REDIS_PORT || "6379"),
  tls: {}
}

const queue = new Queue("Scrape", { connection })
const queueEvents = new QueueEvents("Scrape", { connection })

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

  const job = await queue.add(
    "scrape",
    { url, selector, javascript, wait, block },
    {
      removeOnComplete: true,
      removeOnFail: true
    }
  )

  const result = await job.waitUntilFinished(queueEvents)

  if (await job.isFailed()) {
    return res.status(500).send("timeout")
  }

  res.send(result)
})

app.post("/request", async (req, res) => {
  let { url, body, method, headers } = await req.urlencoded()

  method = method || "GET"
  headers = headers || {}

  if (!url) {
    return res.status(400).send("Missing url query parameter")
  }

  const job = await queue.add("request", { url, body, method, headers })

  res.send(await job.waitUntilFinished(queueEvents))
})

app.listen(3000)
  .then(() => console.log("Listening on port 3000"))
