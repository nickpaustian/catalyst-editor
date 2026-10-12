import { debug } from "../utils"

export default class DBManager {
  private static instance: DBManager
  private dbName: string = ""
  private storeName: string = ""
  private version: number = 1
  private db: IDBDatabase | null = null
  private initStarted: boolean = false

  constructor(
    dbName: string = "database",
    storeName: string = "keyvalue",
    version: number = 1
  ) {
    this.dbName = dbName
    this.storeName = storeName
    this.version = version
    this.db = null
  }

  public static getInstance(
    dbName: string = "database",
    storeName: string = "keyvalue",
    version: number = 1
  ): DBManager {
    if (!DBManager.instance) {
      DBManager.instance = new DBManager(dbName, storeName, version)
    }
    return DBManager.instance
  }

  async init(): Promise<void> {
    if (this.initStarted) return
    this.initStarted = true

    return new Promise((resolve, reject) => {
      debug("DB start init", "Index-db")
      const request = indexedDB.open(this.dbName, this.version)

      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        this.db = request.result
        debug(["DB success init: ", this.db], "Index-db")
        resolve()
      }

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: "key" })
        }
      }
    })
  }

  async write<T>(key: string, value: T): Promise<void> {
    debug(["DB write start: ", this.db], "indexDb")

    if (!this.db) {
      debug("Database not initialised. Call init() first.", "error")
      return
    }

    const transaction = this.db.transaction([this.storeName], "readwrite")
    const store = transaction.objectStore(this.storeName)

    return new Promise((resolve, reject) => {
      const request = store.put({ key, value, timestamp: Date.now() })
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve()
    })
  }

  async read<T>(key: string): Promise<T | null> {
    if (!this.db) {
      debug("Database not initialised. Call init() first.", "error")
      return null
    }

    const transaction = this.db.transaction([this.storeName], "readonly")
    const store = transaction.objectStore(this.storeName)

    return new Promise((resolve, reject) => {
      const request = store.get(key)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const result = request.result
        resolve(result ? result.value : null)
      }
    })
  }

  async delete(key: string): Promise<void> {
    if (!this.db) {
      debug("Database not initialised. Call init() first.", "error")
      return
    }

    const transaction = this.db.transaction([this.storeName], "readwrite")
    const store = transaction.objectStore(this.storeName)

    return new Promise((resolve, reject) => {
      const request = store.delete(key)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve()
    })
  }

  async clear(): Promise<void> {
    if (!this.db) {
      debug("Database not initialised. Call init() first.", "error")
      return
    }

    const transaction = this.db.transaction([this.storeName], "readwrite")
    const store = transaction.objectStore(this.storeName)

    return new Promise((resolve, reject) => {
      const request = store.clear()
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve()
    })
  }

  async getAllKeys(): Promise<IDBValidKey[]> {
    if (!this.db) {
      debug("Database not initialised. Call init() first.", "error")
      return []
    }

    const transaction = this.db.transaction([this.storeName], "readonly")
    const store = transaction.objectStore(this.storeName)

    return new Promise((resolve, reject) => {
      const request = store.getAllKeys()
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result)
    })
  }

  close(): void {
    if (this.db) {
      this.db.close()
      this.db = null
    }
  }
}
