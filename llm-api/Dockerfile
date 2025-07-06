FROM node:18-alpine

WORKDIR /app

COPY ./package.json ./

RUN npm install

RUN npm install nodemon

EXPOSE 3000

CMD ["npx", "nodemon", "app.js"]