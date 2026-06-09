import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ConfigModule } from "@nestjs/config";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ".env",
    }),
    TypeOrmModule.forRoot({
      type: "postgres",
      host: process.env.DB_HOST || "localhost",
      port: parseInt(process.env.DB_PORT || "5432"),
      username: process.env.DB_USER || "erpadmin",
      password: process.env.DB_PASSWORD || "erpadmin123",
      database: process.env.DB_NAME || "erp_db",
      entities: ["dist/**/*.entity{.ts,.js}"],
      synchronize: true,
      logging: process.env.LOG_LEVEL === "debug",
    }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

