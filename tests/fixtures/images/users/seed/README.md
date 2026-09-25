# Seed user images

Profile images for seeded and test users. The Tigris mock serves this directory,
so an object key like `users/seed/profile-images/kody.png` resolves to
`profile-images/kody.png` here. The keys use the same shape as uploaded images
(`users/<userId>/profile-images/<file>`) because the image proxy only accepts
that shape; `seed` stands in for the user id.
