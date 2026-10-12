import ManagerRegistry from "./ManagerRegistry"

export default abstract class BaseManager {
  protected _managers: ManagerRegistry | null = null

  public setManagers(managers: ManagerRegistry): void {
    this._managers = managers
  }

  public get managers(): ManagerRegistry {
    if (!this._managers) this._managers = ManagerRegistry.getInstance()

    return this._managers
  }
}
