# Usamos Node 20 como base
FROM node:20

# Instalar FFmpeg y dependencias del sistema
RUN apt-get update && apt-get install -y ffmpeg && apt-get clean

# Crear directorio de trabajo
WORKDIR /app

# Copiar package.json e instalar dependencias
COPY package*.json ./
RUN npm install --production

# Copiar el resto del proyecto
COPY . .

# Exponer el puerto que tu app usa (ej. 3000)
EXPOSE 3000

# Comando para iniciar tu app
CMD ["node", "index.js"]
