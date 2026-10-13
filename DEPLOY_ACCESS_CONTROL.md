# Activar el control de acceso

El frontend ya contiene el ingreso por usuario, permisos por categoría y la administración de cuentas. Para activarlo en producción hay que aplicar también la parte segura de Supabase.

## 1. Actualizar la base de datos

1. Abre el proyecto en Supabase.
2. Entra en SQL Editor.
3. Copia y ejecuta todo el archivo supabase/access-control.sql.

Este script:

- conserva las tarjetas visibles para visitantes;
- deja de exponer las URL completas públicamente;
- permite obtener una URL únicamente a usuarios autorizados;
- crea permisos por categoría;
- restringe la creación, edición y eliminación de enlaces al administrador.

## 2. Desplegar la función segura

Desde la carpeta principal del proyecto:

    npx supabase login
    npx supabase link --project-ref TU_PROJECT_REF
    npx supabase functions deploy manage-users

La función está en supabase/functions/manage-users/index.ts. La clave SUPABASE_SERVICE_ROLE_KEY permanece dentro de Supabase y nunca debe agregarse a Vercel, al archivo .env o a GitHub.

## 3. Publicar el frontend

Sube los cambios al repositorio conectado con Vercel. El proyecto mantiene:

- Root Directory: src
- Build Command: npm run build
- Output Directory: dist
- Variables: VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY

## 4. Comprobar

1. Entra como administrador.
2. Abre Administrar.
3. Crea un usuario y marca, por ejemplo, Documentos.
4. Cierra la sesión.
5. Comprueba que el usuario pueda abrir Sistema de Actas, pero no un enlace de Herramientas.
6. Edita el usuario, cambia su contraseña o habilita otra categoría y vuelve a probar.
