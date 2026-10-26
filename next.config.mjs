/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async headers() {
    // Let the staff sign-in page be embedded only on the Amkor Holdings website.
    return [
      {
        source: '/login',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: "frame-ancestors 'self' https://amkorholdings.com https://www.amkorholdings.com",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
