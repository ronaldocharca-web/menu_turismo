# Función manage-users

Esta función usa SUPABASE_SERVICE_ROLE_KEY solamente dentro de Supabase. Nunca agregues esa clave al archivo .env de Vite ni a Vercel.

Después de ejecutar supabase/access-control.sql, despliega la función con estos comandos:

    npx supabase login
    npx supabase link --project-ref TU_PROJECT_REF
    npx supabase functions deploy manage-users

Supabase proporciona automáticamente SUPABASE_URL, SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY a la función desplegada.
