$serverPath = "c:\Users\Fabio\Desktop\plataforma-pesquisas\server"
$webPath = "c:\Users\Fabio\Desktop\plataforma-pesquisas\web"

Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$serverPath'; npm run dev"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$webPath'; npm run dev"
