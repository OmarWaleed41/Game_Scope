import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import GameStorePage from './test.jsx'

createRoot(document.getElementById('root')).render(
  <>
    <GameStorePage />
  </>
)
