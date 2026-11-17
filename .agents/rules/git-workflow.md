# Git Commit & Push Workflow

Al completar cualquier tarea o modificación de código, archivos de configuración o documentación en el proyecto:

1. **Ofrecer siempre la opción de commit y push**:
   Al finalizar la respuesta, consultar siempre al usuario si desea realizar el commit y push de los cambios.

2. **Proporcionar el comando listo para ejecutar**:
   Brindar el bloque de comando exacto y completo para que el usuario pueda copiarlo y ejecutarlo él mismo en la terminal, por ejemplo:
   ```powershell
   git add <archivos_modificados>
   git commit -m "<tipo>(<alcance>): <descripción concisa>"
   git push origin <rama_actual>
   ```

3. **Buenas prácticas en el comando sugerido**:
   - Indicar explícitamente los archivos modificados relevantes o `git add -u` (evitar `git add .` indiscriminado que pueda incluir archivos no deseados o fuera de gitignore).
   - Redactar un mensaje de commit bajo formato Conventional Commits (`feat`, `fix`, `docs`, `refactor`, `chore`).
   - No ejecutar el `commit` ni el `push` de forma automática; dar siempre el comando para que el usuario lo ejecute bajo su control.
