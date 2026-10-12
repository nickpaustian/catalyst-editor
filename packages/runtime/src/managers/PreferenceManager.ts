import { storageNamespace } from "../constants"
import BaseManager from "./BaseManager"

interface StoredPreference<T> {
  value: T
  timestamp: number
  expiresAt: number
}

interface CachedPreference<T> extends StoredPreference<T> {
  lastChecked: number
}

export default class PreferenceManager extends BaseManager {
  private static instance: PreferenceManager
  private storage: Storage
  private namespace: string
  private cache: { [key: string]: CachedPreference<any> } = {}
  private cacheLifetime: number = 600000

  private constructor(
    options: { useSessionStorage?: boolean; namespace?: string } = {}
  ) {
    super()
    const {
      useSessionStorage = false,
      namespace = storageNamespace || "ls__",
    } = options
    this.storage = useSessionStorage ? sessionStorage : localStorage
    this.namespace = namespace
  }

  public static getInstance(options?: {
    useSessionStorage?: boolean
    namespace?: string
  }): PreferenceManager {
    if (!PreferenceManager.instance) {
      PreferenceManager.instance = new PreferenceManager(options)
    }
    return PreferenceManager.instance
  }

  private getNamespacedKey(key: string): string {
    return `${this.namespace}${key}`
  }

  public setPreference<T>(
    key: string,
    value: T,
    expiresInMs: number = -1
  ): void {
    try {
      const storedPreference: StoredPreference<T> = {
        value: value,
        timestamp: Date.now(),
        expiresAt: expiresInMs === -1 ? -1 : Date.now() + expiresInMs,
      }
      const stringValue = JSON.stringify(storedPreference)
      this.storage.setItem(this.getNamespacedKey(key), stringValue)

      // Update cache
      this.cache[key] = { ...storedPreference, lastChecked: Date.now() }
    } catch (error) {
      console.error("Error saving preference:", error)
    }
  }

  public getPreference<T>(
    key: string,
    defaultValue: T | null = null
  ): T | null {
    // Check cache first
    if (this.cache[key] && !this.isCacheExpired(this.cache[key])) {
      return this.cache[key].value
    }

    try {
      const value = this.storage.getItem(this.getNamespacedKey(key))
      if (!value) return defaultValue

      const storedPreference: StoredPreference<T> = JSON.parse(value)
      if (this.isExpired(storedPreference)) {
        this.removePreference(key)
        return defaultValue
      }

      // Update cache
      this.cache[key] = { ...storedPreference, lastChecked: Date.now() }

      return storedPreference.value
    } catch (error) {
      console.error("Error retrieving preference:", error)
      return defaultValue
    }
  }

  public getPreferenceMetadata<T>(key: string): StoredPreference<T> | null {
    // Check cache first
    if (this.cache[key] && !this.isCacheExpired(this.cache[key])) {
      const { lastChecked, ...metadata } = this.cache[key]
      return metadata
    }

    try {
      const value = this.storage.getItem(this.getNamespacedKey(key))
      if (!value) return null

      const storedPreference: StoredPreference<T> = JSON.parse(value)
      if (this.isExpired(storedPreference)) {
        this.removePreference(key)
        return null
      }

      // Update cache
      this.cache[key] = { ...storedPreference, lastChecked: Date.now() }

      return storedPreference
    } catch (error) {
      console.error("Error retrieving preference metadata:", error)
      return null
    }
  }

  public removePreference(key: string): void {
    this.storage.removeItem(this.getNamespacedKey(key))
    delete this.cache[key]
  }

  public clearAllPreferences(): void {
    Object.keys(this.storage).forEach((key) => {
      if (key.startsWith(this.namespace)) {
        this.storage.removeItem(key)
      }
    })
    this.cache = {}
  }

  private isExpired<T>(preference: StoredPreference<T>): boolean {
    return preference.expiresAt !== -1 && Date.now() > preference.expiresAt
  }

  private isCacheExpired<T>(cachedPreference: CachedPreference<T>): boolean {
    return Date.now() - cachedPreference.lastChecked > this.cacheLifetime
  }

  public invalidateCache(key: string): void {
    delete this.cache[key]
  }

  public setCacheLifetime(lifetime: number): void {
    this.cacheLifetime = lifetime
  }
}
