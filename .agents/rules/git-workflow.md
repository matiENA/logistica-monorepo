# Git Commit & Push Workflow

Al completar cualquier tarea o modificación de código, archivos de configuración o documentación en el proyecto:

1. **Ofrecer siempre la opción de commit y push**:
   Al finalizar la respuesta, consultar siempre al usuario si desea realizar el commit y push de los cambios.

2. **Proporcionar comandos PowerShell listos desde el directorio predeterminado (`PS C:\Users\Matias Rodriguez>`)**:
   - Incluir **siempre** `Set-Location "<ruta_absoluta_del_repo>"` como primera línea para que el usuario pueda pegar y ejecutar directamente al abrir Windows PowerShell 5.1 desde la barra de tareas.
   - Mantener compatibilidad con Windows PowerShell 5.1 (comandos en líneas separadas, **sin `&&`**).
   - Entregar **siempre ambas opciones**:

   **Opción 1 — Solo los cambios realizados en la tarea:**
   ```powershell
   Set-Location "<ruta_absoluta_del_repo>"
   git add "<archivo_1>" "<archivo_2>"
   git commit -m "<tipo>(<alcance>): <descripción concisa>"
   git push origin <rama_actual>
   ```

   **Opción 2 — Todo el directorio del microservicio / app intervenido:**
   ```powershell
   Set-Location "<ruta_absoluta_del_repo>"
   git add "<directorio_microservicio>"
   git commit -m "<tipo>(<alcance>): <descripción concisa>"
   git push origin <rama_actual>
   ```

3. **Buenas prácticas y control del usuario**:
   - Evitar `git add .` global indiscriminado sobre todo el monorepo; acotar a los archivos puntuales (Opción 1) o al directorio del microservicio intervenido (Opción 2).
   - Redactar el mensaje bajo formato Conventional Commits (`feat`, `fix`, `docs`, `refactor`, `chore`).
   - No ejecutar `commit` ni `push` de forma automática; mantener siempre el control en manos del usuario salvo petición expresa.
