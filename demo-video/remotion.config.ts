import { Config } from "@remotion/cli/config";

Config.setPublicDir("./assets");
Config.setVideoImageFormat("jpeg");
Config.setJpegQuality(95);
Config.setPixelFormat("yuv420p");
Config.setColorSpace("bt709");
Config.setConcurrency(4);
