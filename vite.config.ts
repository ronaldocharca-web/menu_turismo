import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    // El repositorio también contiene una instalación dentro de /src.
    // Forzamos una sola copia de React para evitar errores de hooks en desarrollo.
    dedupe: ['react', 'react-dom'],
  },
})
