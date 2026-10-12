type OnChange = (property: string, value: any) => void

const createReactiveObject = <T extends Record<string, any>>(
  obj: T,
  onChange: OnChange
): T => {
  const handler: ProxyHandler<T> = {
    get(target, property, receiver) {
      return Reflect.get(target, property, receiver)
    },
    set(target, property, value) {
      const result = Reflect.set(target, property, value)
      onChange(property as string, value)
      return result
    },
  }
  return new Proxy(obj, handler)
}

export default createReactiveObject
