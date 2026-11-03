# ==============================================================
# Sonda de Verificación de Salud — Monorepo Logística
# ==============================================================
param (
    [string]$BaseUrl = "https://diaria-operativas.onrender.com"
)

$endpoints = @(
    "/health",
    "/api/dash/flota",
    "/api/dash/tipos-novedad",
    "/api/dash/terminales",
    "/api/dash/novedades",
    "/status"
)

Write-Host "🔍 Verificando servicio maestro en: $BaseUrl" -ForegroundColor Cyan

foreach ($ep in $endpoints) {
    $url = "$BaseUrl$ep"
    try {
        $code = curl.exe -s -o /dev/null -w "%{http_code}" --max-time 6 $url
        if ($code -eq "200") {
            Write-Host "  ✅ $ep -> HTTP $code" -ForegroundColor Green
        } else {
            Write-Host "  ⚠️ $ep -> HTTP $code" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "  ❌ $ep -> Error de conexión" -ForegroundColor Red
    }
}
