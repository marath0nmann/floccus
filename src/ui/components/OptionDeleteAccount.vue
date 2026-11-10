<template>
  <div v-if="!isManagedLocked()">
    <div
      class="text-h6"
      role="heading"
      aria-level="3">
      {{ t('LabelRemoveaccount') }}
    </div>
    <div class="caption">
      {{ t('DescriptionRemoveaccount') }}
    </div>
    <v-btn
      small
      color="red accent-1"
      class="mt-3"
      @click="onClick">
      {{ t('LabelRemoveaccount') }}
    </v-btn>
  </div>
</template>

<script>
export default {
  name: 'OptionDeleteAccount',
  inject: {
    // Profiles locked by a managed policy can't be removed, see AccountOptions
    isManagedLocked: { default: () => () => false },
  },
  methods: {
    onClick() {
      if (window.confirm('Do you really want to remove this account?')) {
        this.$emit('click')
      }
    }
  }
}
</script>

<style scoped>

</style>
