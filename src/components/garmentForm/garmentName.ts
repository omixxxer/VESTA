// The name proposed while the user has not typed one: subcategory, up to two colours and the brand,
// with the colour agreeing with feminine garments («Camiseta blanca · Zara»).

const feminineSubcategories = new Set([
  'bata',
  'blusa',
  'camisa',
  'camiseta',
  'camiseta de tirantes',
  'chaqueta',
  'chaqueta de invierno',
  'falda',
  'media',
  'medias',
  'prenda deportiva',
  'prenda de abrigo',
  'sudadera con capucha'
])
const feminineColors: Record<string, string> = {
  blanco: 'blanca',
  negro: 'negra',
  rojo: 'roja',
  morado: 'morada',
  'gris claro': 'gris clara',
  'gris oscuro': 'gris oscura'
}
export function createSuggestedGarmentName(subcategory: string, colors: string[], brand: string): string {
  const colorNames = colors.map((color) => color.trim()).filter(Boolean).slice(0, 2)
  const isFeminine = feminineSubcategories.has(subcategory.trim().toLocaleLowerCase('es'))
  const colorText = colorNames.map((color) => {
    const normalized = color.toLocaleLowerCase('es')
    const genderedColor = isFeminine
      ? feminineColors[normalized] ?? normalized
      : normalized
    return genderedColor
  }).join(' y ')
  const name = [subcategory.trim(), colorText].filter(Boolean).join(' ')
  return [name, brand.trim() ? `· ${brand.trim()}` : ''].filter(Boolean).join(' ').slice(0, 80).trimEnd()
}
