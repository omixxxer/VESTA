import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { DriveRestore } from '../cloud/driveSync'
import type { DriveSync } from '../cloud/useDriveSync'
import type { ImportMode, WardrobeBackup } from '../db/wardrobeBackup'
import type { Garment } from '../types/domain'

interface WardrobeDataProps {
  garments: Garment[]
  /** Called after an import so the wardrobe is read again. */
  onImported: () => Promise<unknown>
  drive: DriveSync
  /** Places the menu (next to the other page actions) and the notices (below the heading). */
  children: (parts: { menu: ReactNode; notices: ReactNode }) => ReactNode
}

function download(file: Blob, name: string) {
  const url = URL.createObjectURL(file)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`
}

const today = () => new Date().toISOString().slice(0, 10)
const time = (iso: string) => new Intl.DateTimeFormat('es', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso))

/**
 * Backup of the whole wardrobe (to a file or to the user's Google Drive, and back) and the training data export,
 * under one «Datos» menu.
 */
export default function WardrobeData({ garments, onImported, drive, children }: WardrobeDataProps) {
  const menu = useRef<HTMLDetailsElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [pending, setPending] = useState<{ backup: WardrobeBackup; name: string; remote?: DriveRestore['remote'] }>()

  function closeMenu() {
    if (menu.current) menu.current.open = false
  }

  // A <details> menu stays open by itself; close it on a click outside or Escape, like other menus.
  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      if (menu.current?.open && !menu.current.contains(event.target as Node)) closeMenu()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && menu.current?.open) closeMenu()
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  async function exportBackup() {
    closeMenu()
    setBusy('Preparando la copia…')
    setMessage('')
    try {
      // Loaded on demand: the ZIP code is only needed for these actions.
      const { createWardrobeBackup } = await import('../db/wardrobeBackup')
      download(await createWardrobeBackup(), `vesta-armario-${today()}.zip`)
      setMessage(`Copia descargada con ${plural(garments.length, 'prenda', 'prendas')}, sus fotos, outfits y preferencias. Contiene tus fotos: guárdala en un sitio seguro.`)
    } catch (error) {
      console.error('No se pudo exportar el armario:', error)
      setMessage('No se pudo generar la copia. Comprueba el espacio disponible e inténtalo de nuevo.')
    } finally {
      setBusy('')
    }
  }

  async function chooseBackup(file: File | undefined) {
    if (fileInput.current) fileInput.current.value = ''
    if (!file) return
    setBusy('Leyendo la copia…')
    setMessage('')
    try {
      const { readWardrobeBackup } = await import('../db/wardrobeBackup')
      setPending({ backup: await readWardrobeBackup(file), name: file.name })
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo leer la copia.')
    } finally {
      setBusy('')
    }
  }

  async function readFromDrive() {
    closeMenu()
    setBusy('Descargando de Google Drive…')
    setMessage('')
    try {
      const { backup, remote } = await drive.read()
      setPending({ backup, name: 'Google Drive', remote })
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo leer la copia de Google Drive.')
    } finally {
      setBusy('')
    }
  }

  function overwriteDrive() {
    if (window.confirm('¿Sobrescribir la copia de Google Drive con este armario? Los cambios hechos desde el otro dispositivo se perderán (Drive guarda versiones anteriores durante un tiempo).')) {
      void drive.save({ interactive: true, overwrite: true })
    }
  }

  async function importBackup(mode: ImportMode) {
    if (!pending) return
    if (mode === 'replace' && garments.length > 0
      && !window.confirm(`¿Reemplazar tu armario? Se borrarán tus ${plural(garments.length, 'prenda', 'prendas')} actuales, sus outfits y preferencias, y se cargará la copia. No se puede deshacer.`)) {
      return
    }
    setBusy('Importando…')
    try {
      const { importWardrobeBackup } = await import('../db/wardrobeBackup')
      const summary = await importWardrobeBackup(pending.backup, mode)
      if (pending.remote) drive.markRestored(pending.remote)
      setPending(undefined)
      await onImported()
      const parts = [
        `${plural(summary.added, 'prenda añadida', 'prendas añadidas')}`,
        ...(summary.updated ? [`${plural(summary.updated, 'actualizada', 'actualizadas')}`] : []),
        ...(summary.unchanged ? [`${plural(summary.unchanged, 'ya estaba', 'ya estaban')}`] : []),
        `${plural(summary.outfits, 'outfit', 'outfits')}`
      ]
      setMessage(`Copia importada: ${parts.join(', ')}.${summary.recoded ? ` ${plural(summary.recoded, 'prenda ha recibido', 'prendas han recibido')} un código nuevo porque el suyo ya estaba en uso.` : ''}`)
    } catch (error) {
      console.error('No se pudo importar la copia:', error)
      setMessage('No se pudo importar la copia; tu armario no ha cambiado.')
    } finally {
      setBusy('')
    }
  }

  async function exportTrainingData() {
    closeMenu()
    setBusy('Preparando exportación…')
    setMessage('')
    try {
      const { createTrainingExport } = await import('../ml/datasetExport')
      download(await createTrainingExport(garments), `vesta-dataset-${today()}.zip`)
      setMessage(`Exportadas ${plural(garments.length, 'prenda', 'prendas')} con sus fotos y etiquetas. El archivo se genera en este dispositivo; no incluye nombres, marcas, tallas ni notas.`)
    } catch (error) {
      console.error('No se pudo exportar el dataset:', error)
      setMessage('No se pudo generar la exportación. Comprueba el espacio disponible e inténtalo de nuevo.')
    } finally {
      setBusy('')
    }
  }

  const exportedAt = pending && new Intl.DateTimeFormat('es', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(pending.backup.exportedAt))

  const menuElement = (
    <>
      <details className="data-menu" ref={menu}>
        <summary className="button button-outline" aria-disabled={Boolean(busy)}>{busy || 'Datos'}</summary>
        <div className="data-menu-items">
          <button type="button" onClick={() => void exportBackup()} disabled={Boolean(busy) || garments.length === 0}>
            Exportar copia del armario
            <small>Prendas, fotos, outfits y preferencias en un ZIP</small>
          </button>
          <button type="button" onClick={() => { closeMenu(); fileInput.current?.click() }} disabled={Boolean(busy)}>
            Importar copia
            <small>Desde un ZIP exportado por VESTA</small>
          </button>
          {drive.configured ? (
            <>
              <p className="data-menu-heading">Google Drive</p>
              <button type="button" onClick={() => { closeMenu(); void drive.save({ interactive: true }) }} disabled={Boolean(busy) || drive.status.kind === 'saving'}>
                Guardar en Google Drive
                <small>{drive.settings.lastSavedAt ? `Última copia desde aquí: ${time(drive.settings.lastSavedAt)}` : 'En una carpeta privada de VESTA en tu Drive'}</small>
              </button>
              <button type="button" onClick={() => void readFromDrive()} disabled={Boolean(busy) || drive.status.kind === 'saving'}>
                Restaurar desde Google Drive
                <small>Descarga la copia y eliges combinar o reemplazar</small>
              </button>
              <label className="data-menu-toggle">
                <input type="checkbox" checked={drive.settings.autoSave} onChange={(event) => void drive.setAutoSave(event.target.checked)} />
                <span>Guardar automáticamente<small>Unos segundos después de cada cambio, mientras la sesión de Google siga activa</small></span>
              </label>
            </>
          ) : (
            <p className="data-menu-note">Google Drive no está configurado en esta instalación.</p>
          )}
          <p className="data-menu-heading">Modelo de VESTA</p>
          <button type="button" onClick={() => void exportTrainingData()} disabled={Boolean(busy) || garments.length === 0}>
            Exportar datos de entrenamiento
            <small>Fotos y etiquetas, sin nombres, marcas ni notas</small>
          </button>
        </div>
      </details>
      <input
        ref={fileInput}
        className="visually-hidden"
        type="file"
        accept=".zip,application/zip"
        aria-label="Seleccionar copia del armario"
        tabIndex={-1}
        onChange={(event) => void chooseBackup(event.target.files?.[0])}
      />
    </>
  )

  const status = drive.status
  const notices = (
    <>
      {drive.configured && status.kind !== 'idle' && (
        <div className={`drive-status ${status.kind === 'error' ? 'drive-status-error' : ''}`} role="status">
          {status.kind === 'saving' && <p>Guardando en Google Drive… {Math.round(status.progress * 100)} %</p>}
          {status.kind === 'saved' && <p>Copia guardada en Google Drive ({time(status.at)}).</p>}
          {status.kind === 'pending' && <p>Hay cambios sin guardar en Google Drive; se guardarán en unos segundos.</p>}
          {status.kind === 'error' && (
            <>
              <p>{status.message}</p>
              <div className="import-panel-actions">
                {status.reason === 'sign-in' && <button className="button button-dark" type="button" onClick={() => void drive.save({ interactive: true })}>Conectar y guardar</button>}
                {status.reason === 'conflict' && (
                  <>
                    <button className="button button-dark" type="button" onClick={() => void readFromDrive()}>Restaurar y combinar</button>
                    <button className="button button-outline" type="button" onClick={overwriteDrive}>Sobrescribir Drive</button>
                  </>
                )}
                {status.reason === 'other' && <button className="button button-outline" type="button" onClick={() => void drive.save({ interactive: true })}>Reintentar</button>}
              </div>
            </>
          )}
        </div>
      )}
      {pending && (
        <section className="import-panel" aria-label="Importar copia">
          <p>
            <strong>{pending.name}</strong>: copia del {exportedAt} con {plural(pending.backup.garments.length, 'prenda', 'prendas')} y {plural(pending.backup.outfits.length, 'outfit', 'outfits')}.
          </p>
          {garments.length > 0 && (
            <p className="import-panel-hint">
              Combinar añade lo que no tienes y, si una prenda está en los dos sitios, se queda con la versión más reciente. Reemplazar deja tu armario exactamente como la copia.
            </p>
          )}
          <div className="import-panel-actions">
            {garments.length > 0 ? (
              <>
                <button className="button button-dark" type="button" onClick={() => void importBackup('merge')} disabled={Boolean(busy)}>Combinar con mi armario</button>
                <button className="button button-outline" type="button" onClick={() => void importBackup('replace')} disabled={Boolean(busy)}>Reemplazar mi armario</button>
              </>
            ) : (
              <button className="button button-dark" type="button" onClick={() => void importBackup('replace')} disabled={Boolean(busy)}>Importar</button>
            )}
            <button className="button button-outline" type="button" onClick={() => setPending(undefined)} disabled={Boolean(busy)}>Cancelar</button>
          </div>
        </section>
      )}
      {message && <p className="export-note" role="status">{message}</p>}
    </>
  )

  return children({ menu: menuElement, notices })
}
