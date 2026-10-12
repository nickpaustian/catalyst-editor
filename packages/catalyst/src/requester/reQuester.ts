import axios, {
  type AxiosInstance,
  type AxiosRequestConfig,
  AxiosHeaders,
} from "axios"

interface LocalStoreOptions {
  name: string
  cacheTime?: number
  refreshInBackground?: boolean
}

interface RequestOptions extends AxiosRequestConfig {
  localStore?: LocalStoreOptions
  instance?: string
  priority?: number
}

interface ReQuesterResponse<T = any> {
  data: T
  reQuesterStatus?: string
  status?: number
  statusText?: string
  headers?: any
  config?: AxiosRequestConfig
  request?: any
  backgroundRefresh?: Promise<T>
}

interface CacheEntry {
  value: any
  timestamp: number
  expiresAt: number
}

class reQuester {
  private index: number
  private processAsyncCount: number
  private queue: reQuest[]
  private processing: reQuest[]
  private succeeded: reQuest[]
  private failed: reQuest[]
  private instances: { [key: string]: AxiosInstance }

  constructor(_processAsyncCount = 30) {
    this.index = 0
    this.processAsyncCount = _processAsyncCount
    this.queue = []
    this.processing = []
    this.succeeded = []
    this.failed = []
    this.instances = {}
    this.instances.default = axios.create()
  }

  registerInstance = (
    _name: string,
    _opts?: AxiosRequestConfig
  ): AxiosInstance => {
    this.instances[_name] = axios.create({
      baseURL: _opts?.baseURL ? _opts.baseURL : undefined,
      timeout: _opts?.timeout ? _opts.timeout : 5000,
    })

    this.instances[_name].interceptors.request.use(
      async (config) => {
        config.headers = new AxiosHeaders({
          "content-type": "application/x-www-form-urlencoded",
          ...config.headers?.toObject(),
        })
        return config
      },
      (error) => {
        return Promise.reject(error)
      }
    )

    return this.instances[_name]
  }

  fetch = (
    _url: string,
    _options: RequestOptions = {}
  ): Promise<ReQuesterResponse> => {
    const request = new reQuest(_url, _options, this.index)
    this.index++
    this.addToQueue(request)
    this.processQueue()

    return request.promise
  }

  private addToQueue = (_request: reQuest): void => {
    this.queue.push(_request)
  }

  private transferBetweenQueues = (
    _from: reQuest[],
    _to: reQuest[],
    _request: reQuest
  ): reQuest[] => {
    _to.push(_request)
    return _from.filter((request) => request.index !== _request.index)
  }

  private requestSucceeded = (_request: reQuest): void => {
    this.processing = this.transferBetweenQueues(
      this.processing,
      this.succeeded,
      _request
    )
  }

  private requestFailed = (_request: reQuest, _error: any): void => {
    this.processing = this.transferBetweenQueues(
      this.processing,
      this.failed,
      _request
    )
  }

  private processQueue = (): void => {
    if (this.queue.length) {
      this.queue.sort((a, b) => b.priority - a.priority)
      this.processRequest(this.queue[0])
    }
  }

  private getFromStorage(key: string): CacheEntry | null {
    try {
      const item = localStorage.getItem(`reQuester__${key}`)
      if (!item) return null

      const entry: CacheEntry = JSON.parse(item)

      // Check if expired
      if (entry.expiresAt < Date.now()) {
        localStorage.removeItem(`reQuester__${key}`)
        return null
      }

      return entry
    } catch (error) {
      console.error(`Failed to retrieve cache for ${key}:`, error)
      return null
    }
  }

  private setInStorage(key: string, value: any, minutes: number): void {
    try {
      const entry: CacheEntry = {
        value,
        timestamp: Date.now(),
        expiresAt: Date.now() + minutes * 60000,
      }
      localStorage.setItem(`reQuester__${key}`, JSON.stringify(entry))
    } catch (error) {
      console.error(`Failed to store cache for ${key}:`, error)
    }
  }

  private performFetch = async (_request: reQuest): Promise<void> => {
    const method = _request.options.method ?? "get"

    try {
      let instance = this.instances.default

      if (_request.options.instance) {
        instance = this.instances[_request.options.instance]
      }

      let opts: AxiosRequestConfig = {
        method,
        url: _request.url,
        headers: _request.options.headers ?? {},
        data: _request.options.data ?? undefined,
      }

      let response = await instance(opts)

      this.requestSucceeded(_request)
      _request.resolve({ data: response.data, reQuesterStatus: "success" })

      if (_request.options.localStore) {
        const cacheTime = _request.options.localStore.cacheTime ?? 5
        this.setInStorage(
          _request.options.localStore.name,
          response.data,
          cacheTime
        )
      }

      this.processQueue()
    } catch (error) {
      if (axios.isAxiosError(error) && error.response) {
        let msg = error.response.data?.message ?? error.response.statusText

        this.requestFailed(_request, {
          message: msg,
          status: error.response.status,
        })

        console.log("Axios error message:", error.message)
        console.log("Axios error code:", error.code)
        console.log("Axios response status:", error.response?.status)
        console.log("Axios response data:", error.response?.data)
        console.log("Axios response headers:", error.response?.headers)

        _request.resolve({
          data: {
            error: error.response?.data?.error,
            message:
              error.response?.data?.message ??
              error.response?.statusText ??
              "Request failed",
            status: error.response?.status,
          },
          reQuesterStatus: "error",
        })
        return
      }

      this.requestFailed(_request, error)
      _request.resolve({ data: error, reQuesterStatus: "error" })
    }
  }

  private fetchAndUpdateCache = async (_request: reQuest): Promise<any> => {
    const method = _request.options.method ?? "get"

    try {
      let instance = this.instances.default

      if (_request.options.instance) {
        instance = this.instances[_request.options.instance]
      }

      let opts: AxiosRequestConfig = {
        method,
        url: _request.url,
        headers: _request.options.headers ?? {},
        data: _request.options.data ?? undefined,
      }

      let response = await instance(opts)

      if (_request.options.localStore) {
        const cacheTime = _request.options.localStore.cacheTime ?? 5
        this.setInStorage(
          _request.options.localStore.name,
          response.data,
          cacheTime
        )
      }

      return response.data
    } catch (error) {
      throw error
    }
  }

  private processRequest = async (_request: reQuest): Promise<void> => {
    if (this.processing.length >= this.processAsyncCount) {
      return
    }

    this.queue = this.transferBetweenQueues(
      this.queue,
      this.processing,
      _request
    )

    if (_request.options.localStore) {
      const storedEntry = this.getFromStorage(_request.options.localStore.name)

      if (storedEntry) {
        // Valid cache, return it
        this.requestSucceeded(_request)

        let backgroundRefreshPromise: Promise<any> | undefined
        if (_request.options.localStore.refreshInBackground) {
          backgroundRefreshPromise = this.fetchAndUpdateCache(_request)
        }

        _request.resolve({
          data: storedEntry.value,
          reQuesterStatus: "cached",
          backgroundRefresh: backgroundRefreshPromise,
        })

        this.processQueue()
        return
      }
    }

    // No cache or cache expired, perform normal fetch
    await this.performFetch(_request)
  }

  getFormData = (object: Record<string, any>): FormData =>
    Object.keys(object).reduce((formData, key) => {
      formData.append(key, object[key])
      return formData
    }, new FormData())
}

class reQuest {
  url: string
  options: RequestOptions
  response: any
  index: number
  priority: number
  promise: Promise<ReQuesterResponse>
  resolve!: (value: ReQuesterResponse | PromiseLike<ReQuesterResponse>) => void
  reject!: (reason?: any) => void

  constructor(_url: string, _options: RequestOptions = {}, _index: number) {
    this.url = _url
    this.options = _options
    this.response = null
    this.index = _index
    this.priority = _options.priority ?? 0
    this.promise = new Promise<ReQuesterResponse>((resolve, reject) => {
      this.resolve = resolve
      this.reject = reject
    })
  }
}

export { reQuester }
