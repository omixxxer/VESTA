import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react'
import { garmentRepository } from '../db/garmentRepository'
import GarmentDetailPanel from '../components/GarmentDetailPanel'
import GarmentForm from '../components/GarmentForm'
import Masonry from '../components/Masonry.jsx'
import PatternWaves from '../components/PatternWaves.jsx'
import PillNav from '../components/PillNav.jsx'
import OutfitGenerator from '../components/OutfitGenerator'
import TripPlanner from '../components/TripPlanner'
import { garmentCategories, type Garment } from '../types/domain'

type Page = 'wardrobe' | 'add' | 'outfits' | 'packing'

type GalleryItem = {
  id: string
  img: string
  width: number
  height: number
  alt: string
  title: string
  description: string
  garmentId: string
}

type PillItem = {
  label: string
  href: string
  icon: string
}

const navigation: PillItem[] = [
  { label: 'Armario', href: '#armario', icon: '▦' },
  { label: 'Outfits', href: '#outfits', icon: '✳' },
  { label: 'Maleta', href: '#maleta', icon: '▣' }
]

const pageHrefs: Record<Page, string> = {
  wardrobe: '#armario',
  add: '#armario',
  outfits: '#outfits',
  packing: '#maleta'
}

const localStorageMessage = 'Tus prendas y fotografías se guardan únicamente en este dispositivo.'

function getGarmentLabel(garment: Garment) {
  return garment.name.trim() || garment.subcategory || garment.category
}

function App() {
  const [page, setPage] = useState<Page>('wardrobe')
  const [garments, setGarments] = useState<Garment[]>([])
  const [galleryItems, setGalleryItems] = useState<GalleryItem[]>([])
  const [displayCount, setDisplayCount] = useState(40)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedGarment, setSelectedGarment] = useState<Garment | null>(null)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('Todas')
  const [reducedMotion, setReducedMotion] = useState(false)

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const updatePreference = () => setReducedMotion(preference.matches)
    updatePreference()
    preference.addEventListener('change', updatePreference)
    return () => preference.removeEventListener('change', updatePreference)
  }, [])

  const refreshGarments = useCallback(async () => {
    const list = await garmentRepository.list()
    setGarments(list)
    return list
  }, [])

  useEffect(() => {
    void refreshGarments()
      .catch(() => setError('No se pudo abrir el armario. Comprueba el almacenamiento de este navegador.'))
      .finally(() => setLoading(false))
  }, [refreshGarments])

  const visibleGarments = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase('es')
    return garments.filter((garment) => {
      const searchableText = [garment.name, garment.subcategory, garment.brand, ...garment.colors]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase('es')
      return (!normalizedSearch || searchableText.includes(normalizedSearch))
        && (categoryFilter === 'Todas' || garment.category === categoryFilter)
    })
  }, [categoryFilter, garments, search])

  const visibleGalleryItems = useMemo(() => {
    const visibleIds = new Set(visibleGarments.map((garment) => garment.id))
    return galleryItems.filter((item) => visibleIds.has(item.garmentId))
  }, [galleryItems, visibleGarments])

  useEffect(() => {
    const urls: string[] = []
    const items = visibleGarments.slice(0, displayCount).map((garment) => {
      const img = URL.createObjectURL(garment.thumbnail ?? garment.image)
      urls.push(img)
      const label = getGarmentLabel(garment)
      const details = [garment.category, ...garment.colors].filter(Boolean).join(' · ')
      return {
        id: garment.id,
        garmentId: garment.id,
        img,
        width: garment.width,
        height: garment.height,
        alt: label,
        title: label,
        description: details
      }
    })
    setGalleryItems(items)
    return () => urls.forEach((url) => URL.revokeObjectURL(url))
  }, [displayCount, visibleGarments])

  const closeDetail = useCallback(() => setSelectedGarment(null), [])

  const createGarment = useCallback(async (garment: Garment) => {
    setError('')
    await garmentRepository.create(garment)
    await refreshGarments()
    setPage('wardrobe')
  }, [refreshGarments])

  const updateGarment = useCallback(async (garment: Garment) => {
    setError('')
    await garmentRepository.update(garment)
    await refreshGarments()
    setSelectedGarment(garment)
  }, [refreshGarments])

  const removeGarment = useCallback(async (id: string) => {
    setError('')
    await garmentRepository.remove(id)
    await refreshGarments()
  }, [refreshGarments])

  const updateAvailability = useCallback(async (garment: Garment) => {
    await garmentRepository.update(garment)
    await refreshGarments()
  }, [refreshGarments])

  function handleNavigation(_item: PillItem, index: number, event: MouseEvent<HTMLAnchorElement | HTMLButtonElement>) {
    event.preventDefault()
    const next = (['wardrobe', 'outfits', 'packing'] as const)[index]
    if (next) setPage(next)
  }

  function handleMasonryClick(garmentId: string | undefined) {
      if (!garmentId) return
      const garment = garments.find((entry) => entry.id === garmentId)
    if (garment) setSelectedGarment(garment)
  }

  return (
    <>
      <PatternWaves
        className="app-background"
        preset="lines"
        pattern="line"
        wave="silk"
        spacing={22}
        markSize={0.34}
        depth={0.55}
        light={undefined}
        shine={0.5}
        contrast={0.8}
        scale={1}
        direction={20}
        color="#D8D8C9"
        backgroundColor="#F5F5EF"
        opacity={0.34}
        speed={0.12}
        fade="none"
        interactive={false}
        paused={reducedMotion}
        style={undefined}
      />
      <div className="app-shell">
        <header className="app-header">
          <a className="wordmark" href="#armario" onClick={() => setPage('wardrobe')} aria-label="VESTA, ir al armario">
            VESTA<span aria-hidden="true">.</span>
          </a>
          <span className="privacy-note"><span className="privacy-indicator" />{localStorageMessage}</span>
        </header>

        <main className="screen-content">
          {error && <div className="alert" role="alert">{error}</div>}
          {page === 'wardrobe' && (
            <section aria-labelledby="wardrobe-title">
              <div className="page-heading">
                <div>
                  <p className="eyebrow">TU COLECCIÓN PERSONAL</p>
                  <h1 id="wardrobe-title">Armario<span>.</span></h1>
                  <p className="page-intro">Cada prenda cuenta una historia. Aquí empieza la tuya.</p>
                </div>
                <button className="button button-dark" type="button" onClick={() => setPage('add')}>＋ Añadir prenda</button>
              </div>

              <div className="wardrobe-toolbar">
                <span className="item-count">{garments.length} {garments.length === 1 ? 'PRENDA' : 'PRENDAS'}</span>
                <div className="filters">
                  <label className="search-field">
                    <span aria-hidden="true">⌕</span>
                    <span className="visually-hidden">Buscar prendas</span>
                    <input value={search} onChange={(event) => { setSearch(event.target.value); setDisplayCount(40) }} placeholder="Buscar en tu armario" />
                  </label>
                  <label className="visually-hidden" htmlFor="category-filter">Filtrar por categoría</label>
                  <select id="category-filter" value={categoryFilter} onChange={(event) => { setCategoryFilter(event.target.value); setDisplayCount(40) }}>
                    <option>Todas</option>
                    {garmentCategories.map((category) => <option key={category}>{category}</option>)}
                  </select>
                </div>
              </div>

              {loading ? (
                <div className="loading-state" role="status">Abriendo tu armario…</div>
              ) : visibleGarments.length === 0 ? (
                <section className="empty-state">
                  <div className="empty-mark" aria-hidden="true">✳</div>
                  <p className="eyebrow">{garments.length === 0 ? 'UN BUEN COMIENZO' : 'PRUEBA OTRA BÚSQUEDA'}</p>
                  <h2>{garments.length === 0 ? 'Tu armario empieza aquí.' : 'No encontramos esa prenda.'}</h2>
                  <p>{garments.length === 0
                    ? 'Añade tu primera prenda y crea un espacio propio para todo lo que te encanta vestir.'
                    : 'Cambia el texto o la categoría para ver más resultados.'}</p>
                  {garments.length === 0 && <button className="button button-dark" type="button" onClick={() => setPage('add')}>Añadir primera prenda ↗</button>}
                </section>
              ) : visibleGalleryItems.length === 0 ? (
                <div className="loading-state" role="status">Preparando fotografías…</div>
              ) : (
                <Masonry
                  items={visibleGalleryItems}
                  columns="auto"
                  columnWidth={230}
                  gap={18}
                  radius={8}
                  animateFrom="bottom"
                  duration={0.45}
                  blurToFocus={false}
                  revealOnScroll={false}
                  hoverEffect={reducedMotion ? 'none' : 'zoom'}
                  captions="always"
                  parallax={0}
                  lightbox={false}
                  draggable={false}
                  onItemClick={(item: { garmentId?: string }) => handleMasonryClick(item.garmentId)}
                  className="wardrobe-masonry"
                />
              )}
              {visibleGalleryItems.length < visibleGarments.length && !loading && (
                <div className="catalog-more">
                  <p>Mostrando {visibleGalleryItems.length} de {visibleGarments.length} prendas.</p>
                  <button className="button button-outline" type="button" onClick={() => setDisplayCount((count) => count + 40)}>Cargar 40 más</button>
                </div>
              )}
            </section>
          )}

          {page === 'add' && (
            <section className="form-screen" aria-labelledby="add-title">
              <p className="eyebrow">UNA NUEVA HISTORIA</p>
              <h1 id="add-title">Añadir prenda<span>.</span></h1>
              <p className="page-intro">Las fotografías se procesan en este dispositivo y no se envían a ningún sitio.</p>
              <GarmentForm
                onSave={createGarment}
                onCancel={() => setPage('wardrobe')}
                submitLabel="Guardar prenda"
              />
            </section>
          )}

          {page === 'outfits' && (
            <OutfitGenerator garments={garments} onAvailabilityChange={updateAvailability} />
          )}
          {page === 'packing' && <TripPlanner garments={garments} />}
        </main>

        <PillNav
          items={navigation}
          activeHref={pageHrefs[page]}
          onItemClick={handleNavigation}
          logo={undefined}
          onMenuToggle={undefined}
          style={undefined}
          theme="dark"
          surface="solid"
          layout="split"
          size="md"
          itemStyle="pill"
          hoverEffect="fill"
          indicator="pill"
          barColor="#30352F"
          textColor="#F5F5EF"
          highlightColor="#9AA58E"
          highlightTextColor="#30352F"
          collapse="never"
          intro={false}
          ariaLabel="Navegación principal"
          className="vesta-pill-nav"
        />
      </div>

      {selectedGarment && (
        <GarmentDetailPanel
          garment={selectedGarment}
          onClose={closeDetail}
          onSave={updateGarment}
          onDelete={removeGarment}
        />
      )}
    </>
  )
}

export default App
