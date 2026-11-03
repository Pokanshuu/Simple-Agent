import { createRoot } from 'react-dom/client'
import './styles/base.css'
import './styles/markdown.css'
import { App } from './App'
import { ToastProvider } from './components/ui/primitives'

const container = document.getElementById('root')
if (!container) {
  throw new Error('missing #root')
}

// No StrictMode: its double-invoked effects would start two streams for one send.
createRoot(container).render(
  <ToastProvider>
    <App />
  </ToastProvider>,
)
