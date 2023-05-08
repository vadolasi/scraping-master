import { Cluster } from "puppeteer-cluster"
import puppeteer  from "puppeteer-extra"
import stealth from "puppeteer-extra-plugin-stealth"
import dotenv from "dotenv"
import { ConnectionOptions, Worker } from "bullmq"
import { Page } from "puppeteer"
import { randomUUID } from "crypto"

dotenv.config()

const connection: ConnectionOptions = {
  host: process.env.REDIS_HOST,
  port: parseInt(process.env.REDIS_PORT || "6379")
}

const cache = {} as any

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

/*
puppeteer.use(AdblockerPlugin({
  interceptResolutionPriority: DEFAULT_INTERCEPT_RESOLUTION_PRIORITY
}))
*/
puppeteer.use(stealth())
/*
puppeteer.use(recaptcha({
  provider: {
    id: "2captcha",
    token: process.env.CAPTCHA_API_KEY
  }
}))
*/

;(async () => {
  const cluster = await Cluster.launch({
    concurrency: Cluster.CONCURRENCY_PAGE,
    maxConcurrency: 18,
    puppeteer,
    puppeteerOptions: {
      args,
      headless: "new",
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

  const worker = new Worker(
    "Scrape",
    async job => {
      let result = ""
      const jobId = randomUUID()

      const errorListner = async (error: Error, { id }: { id: string }) => {
        if (id === jobId) {
          throw error
        }
      }

      cluster.on("taskerror", errorListner)

      switch (job.name) {
        case "scrape":
          const { url, selector, javascript, wait, block } = job.data

          await new Promise(resolve => {
            cluster.queue({ id: jobId }, async ({ page }: { page: Page }) => {
              const timeout = setTimeout(async () => {
                throw new Error("Timeout")
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
              result = await page.content()
              resolve(undefined)
            })
          })

        case "request":
          const { url: requestUrl, body, method, headers } = job.data

          new Promise(resolve => {
            cluster.queue(async ({ page }: { page: Page }) => {
              await page.setRequestInterception(true)

              page.on("request", request => {
                request.continue({
                  method: method as string,
                  postData: body as string,
                  headers: headers as Record<string, string>
                })
              })

              await page.goto(requestUrl as string, { waitUntil: "networkidle0", timeout: 150000 })

              result = await page.content()
              resolve(undefined)
            })
          })
      }

      cluster.off("taskerror", errorListner)

      return result
    },
    {
      connection,
      concurrency: 18
    }
  )

  const shutdown = async () => {
    await worker.close()
    await cluster.idle()
    await cluster.close()
    process.exit(0)
  }

  process.on("SIGTERM", shutdown)
  process.on("SIGINT", shutdown)

  console.log("Worker is listening for jobs")
})()
