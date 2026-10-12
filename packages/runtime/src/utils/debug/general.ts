export const isString: (toCheck: any) => boolean = (toCheck) => {
  return typeof toCheck === "string" || toCheck instanceof String
}

export const getObjPathByValue: (
  obj: any,
  value: string,
  path?: string[]
) => string[] | undefined = (obj, value, path = []) => {
  for (const [key, val] of Object.entries(obj)) {
    const currentPath = [...path, key]

    if (val === value) {
      return currentPath
    }

    if (Array.isArray(val)) {
      if (val.includes(value)) {
        return currentPath
      }
    } else if (typeof val === "object" && val !== null) {
      const found = getObjPathByValue(val, value, currentPath)
      if (found) {
        return found
      }
    }
  }

  return undefined
}
