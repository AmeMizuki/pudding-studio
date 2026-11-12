<script>
  import { Switch as SwitchPrimitive } from 'bits-ui';
  import { cn } from '$lib/utils.js';

  let {
    ref = $bindable(null),
    class: className,
    checked = $bindable(false),
    size = 'default',
    ...restProps
  } = $props();
</script>

<SwitchPrimitive.Root
  bind:ref
  bind:checked
  data-slot="switch"
  data-size={size}
  class={cn(
    'switch-control disabled:cursor-not-allowed disabled:opacity-50',
    className
  )}
  {...restProps}
>
  <SwitchPrimitive.Thumb
    data-slot="switch-thumb"
    class={cn(
      'switch-thumb'
    )}
  />
</SwitchPrimitive.Root>
