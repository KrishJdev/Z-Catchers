import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        night: {
          bg: "#120F0D",
          surface: "#1C1714",
          elevated: "#26201B",
          border: "#332B24",
        },
        cream: {
          primary: "#F5EBE1",
          secondary: "#B0A295",
          muted: "#73675C",
        },
        status: {
          amber: "#E59843",
          coral: "#D96B52",
          sage: "#6B9E78",
          slumber: "#5B6B94",
        },
        fox: {
          rust: "#E07A5F",
          amber: "#F4A261",
        },
      },
    },
  },
  plugins: [],
};

export default config;
