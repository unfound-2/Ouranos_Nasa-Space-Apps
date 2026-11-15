import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import '@fontsource/pinyon-script/latin-400.css'
import './styles.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
