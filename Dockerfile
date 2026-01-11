# Imagen base con Node
FROM node:20

# Instalar ffmpeg
RUN apt-get update && apt-get install -y ffmpeg && apt-get clean

# Crear directorio de trabajo
WORKDIR /app

# Copiar package.json y package-lock.json (si existe)
COPY package*.json ./

# Instalar dependencias
RUN npm install

# Copiar el resto del código
COPY . .

# Compilar TypeScript
RUN npm run build

# Puerto de la app
EXPOSE 3000

# Comando para arrancar la app
CMD ["node", "dist/index.js"]
