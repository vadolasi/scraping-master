import { Cluster } from "puppeteer-cluster"
import puppeteer  from "puppeteer-extra"
import stealth from "puppeteer-extra-plugin-stealth"
import dotenv from "dotenv"
import { Page } from "puppeteer"
import { Consumer } from "sqs-consumer"
import { fetch } from "undici"
import { SQS } from "@aws-sdk/client-sqs"

dotenv.config()

const args = [
  "--autoplay-policy=user-gesture-required",
  "--disable-background-networking",
  "--disable-background-timer-throttling",
  "--disable-backgrounding-occluded-windows",
  "--disable-breakpad",
  "--disable-client-side-phishing-detection",
  "--disable-component-update",
  "--disable-default-apps",
  "--disable-dev-shm-usage",
  "--disable-domain-reliability",
  "--disable-extensions",
  "--disable-features=AudioServiceOutOfProcess",
  "--disable-hang-monitor",
  "--disable-ipc-flooding-protection",
  "--disable-notifications",
  "--disable-offer-store-unmasked-wallet-cards",
  "--disable-popup-blocking",
  "--disable-print-preview",
  "--disable-prompt-on-repost",
  "--disable-renderer-backgrounding",
  "--disable-setuid-sandbox",
  "--disable-speech-api",
  "--disable-sync",
  "--hide-scrollbars",
  "--ignore-gpu-blacklist",
  "--metrics-recording-only",
  "--mute-audio",
  "--no-default-browser-check",
  "--no-first-run",
  "--no-pings",
  "--no-sandbox",
  "--no-zygote",
  "--password-store=basic",
  "--use-gl=swiftshader",
  "--use-mock-keychain",
  "--disable-accelerated-2d-canvas",
  "--disable-gpu"
]

puppeteer.use(stealth())

;(async () => {
  const cluster = await Cluster.launch({
    concurrency: Cluster.CONCURRENCY_PAGE,
    maxConcurrency: 18,
    puppeteer,
    puppeteerOptions: {
      args,
      headless: false,
      devtools: false,
      ignoreHTTPSErrors: true,
      defaultViewport: {
        width: 1920,
        height: 1080
      }
    },
    timeout: 150000
  })

  cluster.setMaxListeners(1024)

  const worker = Consumer.create({
    queueUrl: process.env.SQS_URL!,
    handleMessage: async (message) => {
      const {
        id,
        url,
        selector,
        javascript,
        wait,
        block
      } = JSON.parse(message.Body!) as {
        id: string,
        url: string,
        selector?: string,
        javascript?: string,
        wait?: string,
        block: string[]
      }

      const errorListner = async (error: Error, { id: jobId }: { id: string }) => {
        if (id === jobId) {
          throw error
        }
      }

      cluster.on("taskerror", errorListner)

      cluster.queue({ id }, async ({ page }: { page: Page }) => {
        const timeout = setTimeout(async () => {
          await fetch(process.env.API_URL!, {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              id,
              error: "Timeout",
              sucess: false
            })
          })
        }, 150000)

        await page.setRequestInterception(true)
        page.on("request", async request => {
          if (block.includes(request.resourceType()) || request.isNavigationRequest() && request.redirectChain().length > 3) {
            request.abort()
          } else {
            request.continue()
          }
        })
        await page.goto(url as string, { waitUntil: "networkidle0", timeout: 150000 })

        if (selector) {
          await page.waitForSelector(selector as string)
        }

        if (javascript) {
          await page.evaluate(javascript as string)
        }

        if (wait) {
          await page.waitForTimeout(parseInt(wait as string))
        }

        clearTimeout(timeout)
        await fetch(process.env.WEBHOOK_URL!, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            id,
            content: await page.content(),
            success: true
          })
        })
      })

      cluster.off("taskerror", errorListner)
    },
    sqs: new SQS({
      region: "sa-east-1",
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!
      }
    })
  })

  const shutdown = async () => {
    worker.stop()
    await cluster.idle()
    await cluster.close()
    process.exit(0)
  }

  process.on("SIGTERM", shutdown)
  process.on("SIGINT", shutdown)

  console.log("Worker is listening for jobs")
  worker.start()
})()
