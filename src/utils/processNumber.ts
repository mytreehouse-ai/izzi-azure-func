export function processNumber(val: string) {
    const floatParsed = parseFloat(val)
    if (!isNaN(floatParsed)) {
        return floatParsed
    }
    const intParsed = parseInt(val)
    return isNaN(intParsed) ? 0 : intParsed
}
